/**
 * Integration tests — Auth controller & routes.
 *   POST /auth/login   GET /auth/me   POST /auth/logout   GET /auth/guards
 *
 * Philosophy ("usuario caótico"): we assume the frontend is broken or the caller
 * is hostile. Every endpoint is hit with missing fields, wrong types, broken
 * tokens and a DB outage, asserting the API answers with the right status
 * (400 / 401 / 403 / 500) and never crashes the Node process.
 *
 * What is mocked, and why:
 *   ../middleware/dbContext  the real middleware opens a per-request SQL Server
 *                            transaction (RLS infra). Replaced by a pass-through
 *                            so the suite runs fully in memory — no DB, no network.
 *   ../db/users              the data-access layer the controller depends on. We
 *                            drive its return values and force it to throw.
 *   bcryptjs                 fast, deterministic password comparison (and avoids
 *                            the real cost-12 hash at module load).
 *   express-rate-limit       disabled here so the many intentional failed logins
 *                            don't trip the brute-force limiter. The limiter
 *                            itself is covered in authRateLimit.test.ts.
 *
 * jsonwebtoken is NOT mocked: we sign/verify real vi_token cookies.
 */

import request from 'supertest';

// ── Mocks (hoisted above imports by ts-jest) ─────────────────────────────────
jest.mock('../middleware/dbContext', () => ({
  dbContextMiddleware: (_req: any, _res: any, next: any) => next(),
}));
jest.mock('express-rate-limit', () => ({
  __esModule: true,
  default: () => (_req: any, _res: any, next: any) => next(),
}));
jest.mock('../db/users');
jest.mock('bcryptjs', () => ({
  hashSync: jest.fn(() => '$2a$12$mockdummyhashmockdummyhashmockdummyhashmockd'),
  compare: jest.fn(),
}));

import bcrypt from 'bcryptjs';
import { createApp } from '../config/app';
import { findUserByUsername, updateLastLogin, getKioskUsers } from '../db/users';
import { authCookie, userRow } from './helpers';

const mockFind   = findUserByUsername as jest.MockedFunction<typeof findUserByUsername>;
const mockUpdate = updateLastLogin    as jest.MockedFunction<typeof updateLastLogin>;
const mockGuards = getKioskUsers      as jest.MockedFunction<typeof getKioskUsers>;
const mockCompare = bcrypt.compare    as unknown as jest.Mock;

const app = createApp();

beforeAll(() => {
  // errorHandler logs every 500 server-side; we trigger 500s on purpose, so
  // silence the noise to keep test output readable. Restored in afterAll.
  jest.spyOn(console, 'error').mockImplementation(() => {});
});
afterAll(() => {
  (console.error as jest.Mock).mockRestore?.();
});

beforeEach(() => {
  // Happy-path defaults — individual tests override what they care about.
  mockFind.mockResolvedValue(userRow());
  mockUpdate.mockResolvedValue(undefined);
  mockGuards.mockResolvedValue([]);
  mockCompare.mockResolvedValue(true);
});

// ─────────────────────────────────────────────────────────────────────────────
describe('POST /auth/login', () => {
  describe('happy path', () => {
    it('200 + sets an HttpOnly vi_token cookie on valid credentials', async () => {
      const res = await request(app)
        .post('/auth/login')
        .send({ username: 'guard1', password: 'secret' });

      expect(res.status).toBe(200);
      expect(res.body).toMatchObject({
        success: true,
        statusCode: 'LOGIN_SUCCESS',
        uiState: 'saved_successfully',
        data: { user: { username: 'guard1', role: 'guardia' } },
      });

      const cookies = res.headers['set-cookie'] as unknown as string[];
      expect(cookies.some(c => c.startsWith('vi_token='))).toBe(true);
      expect(cookies.some(c => /HttpOnly/i.test(c))).toBe(true);
    });

    it('never returns the password hash in the response', async () => {
      const res = await request(app)
        .post('/auth/login')
        .send({ username: 'guard1', password: 'secret' });

      expect(res.body.data.user).not.toHaveProperty('passwordHash');
    });

    it('normalizes the username (trim + lowercase) before the DB lookup', async () => {
      await request(app)
        .post('/auth/login')
        .send({ username: '  GUARD1  ', password: 'secret' });

      expect(mockFind).toHaveBeenCalledWith('guard1');
    });
  });

  describe('missing data → 400', () => {
    it.each([
      ['empty body',        {}],
      ['missing password',  { username: 'guard1' }],
      ['missing username',  { password: 'secret' }],
      ['null credentials',  { username: null, password: null }],
      ['empty strings',     { username: '', password: '' }],
    ])('%s', async (_label, body) => {
      const res = await request(app).post('/auth/login').send(body as object);

      expect(res.status).toBe(400);
      expect(res.body.statusCode).toBe('MISSING_CREDENTIALS');
      expect(res.body.uiState).toBe('validation_error');
      // Must short-circuit before touching the DB.
      expect(mockFind).not.toHaveBeenCalled();
    });
  });

  describe('bad credentials → 401', () => {
    it('unknown user → 401 (and still runs bcrypt against the dummy hash — timing equalizer)', async () => {
      mockFind.mockResolvedValue(null);
      mockCompare.mockResolvedValue(false);

      const res = await request(app)
        .post('/auth/login')
        .send({ username: 'ghost', password: 'whatever' });

      expect(res.status).toBe(401);
      expect(res.body.statusCode).toBe('INVALID_CREDENTIALS');
      // The bcrypt.compare runs even when the user does not exist, so response
      // latency can't be used to enumerate valid usernames.
      expect(mockCompare).toHaveBeenCalledTimes(1);
    });

    it('wrong password → 401', async () => {
      mockCompare.mockResolvedValue(false);

      const res = await request(app)
        .post('/auth/login')
        .send({ username: 'guard1', password: 'wrong' });

      expect(res.status).toBe(401);
      expect(res.body.statusCode).toBe('INVALID_CREDENTIALS');
    });

    it('inactive (disabled) user → 401', async () => {
      mockFind.mockResolvedValue(userRow({ active: false }));

      const res = await request(app)
        .post('/auth/login')
        .send({ username: 'guard1', password: 'secret' });

      expect(res.status).toBe(401);
      expect(res.body.statusCode).toBe('INVALID_CREDENTIALS');
    });
  });

  describe('misconfigured account → 403', () => {
    it('guardia without an assigned branch → 403 USER_MISCONFIGURED', async () => {
      mockFind.mockResolvedValue(userRow({ role: 'guardia', branchId: null }));

      const res = await request(app)
        .post('/auth/login')
        .send({ username: 'guard1', password: 'secret' });

      expect(res.status).toBe(403);
      expect(res.body.statusCode).toBe('USER_MISCONFIGURED');
    });

    it('admin_pais without an assigned country → 403 USER_MISCONFIGURED', async () => {
      mockFind.mockResolvedValue(
        userRow({ role: 'admin_pais', branchId: null, countryId: null }),
      );

      const res = await request(app)
        .post('/auth/login')
        .send({ username: 'pais1', password: 'secret' });

      expect(res.status).toBe(403);
      expect(res.body.statusCode).toBe('USER_MISCONFIGURED');
    });
  });

  describe('type confusion / malformed requests', () => {
    it('SQL-injection-looking username is treated as data (parameterized) → 401', async () => {
      mockFind.mockResolvedValue(null);
      mockCompare.mockResolvedValue(false);

      const res = await request(app)
        .post('/auth/login')
        .send({ username: "admin' OR 1=1 --", password: 'x' });

      expect(res.status).toBe(401);
      // The literal string is passed straight through to the (mocked) lookup —
      // no string concatenation into SQL on the controller side.
      expect(mockFind).toHaveBeenCalledWith("admin' or 1=1 --");
    });

    it('wrong Content-Type (text/plain) leaves the body unparsed → 400', async () => {
      const res = await request(app)
        .post('/auth/login')
        .set('Content-Type', 'text/plain')
        .send('username=guard1&password=secret');

      expect(res.status).toBe(400);
      expect(res.body.statusCode).toBe('MISSING_CREDENTIALS');
    });

    // ── Findings worth surfacing (assert real behavior, flag the gap) ──────────
    // The controller's guard is `if (!username || !password)`. A non-string but
    // truthy username slips past it and then hits `username.trim()`, which throws
    // for a number. The thrown error is caught and surfaces as a generic 500.
    // Arguably this should be a 400 (invalid type) — hardening opportunity:
    // validate the body shape (e.g. zod) before use.
    it('numeric username currently yields 500 (documents missing type validation)', async () => {
      const res = await request(app)
        .post('/auth/login')
        .send({ username: 12345, password: 'secret' });

      expect(res.status).toBe(500);
      expect(res.body.statusCode).toBe('INTERNAL_ERROR');
    });

    // A whitespace-only username is truthy, so it passes the 400 guard, gets
    // trimmed to '' and looked up (miss) → 401. Not a 400. Same hardening note.
    it('whitespace-only username falls through to 401 (not 400)', async () => {
      mockFind.mockResolvedValue(null);
      mockCompare.mockResolvedValue(false);

      const res = await request(app)
        .post('/auth/login')
        .send({ username: '   ', password: 'secret' });

      expect(res.status).toBe(401);
      expect(mockFind).toHaveBeenCalledWith('');
    });

    // Malformed JSON is rejected by body-parser with a 400-flavored error, but
    // errorHandler only special-cases AppError, so it falls through to 500.
    // Hardening opportunity: map body-parser parse errors to a 400.
    it('malformed JSON body → 500 (documents body-parser error not mapped to 400)', async () => {
      const res = await request(app)
        .post('/auth/login')
        .set('Content-Type', 'application/json')
        .send('{"username": "guard1", ');

      expect(res.status).toBe(500);
      expect(res.body.statusCode).toBe('INTERNAL_ERROR');
    });
  });

  describe('database failure → 500', () => {
    it('DB outage during lookup → 500 with a generic message and no stack leak', async () => {
      mockFind.mockRejectedValue(new Error('ECONNREFUSED 10.0.0.5:1433'));

      const res = await request(app)
        .post('/auth/login')
        .send({ username: 'guard1', password: 'secret' });

      expect(res.status).toBe(500);
      expect(res.body).toMatchObject({
        success: false,
        statusCode: 'INTERNAL_ERROR',
        uiState: 'server_error',
      });
      // The internal error detail must not leak to the client.
      expect(JSON.stringify(res.body)).not.toMatch(/ECONNREFUSED|1433|stack/i);
    });

    it('a DB failure does not crash the process — the next request still works', async () => {
      mockFind.mockRejectedValueOnce(new Error('boom'));
      await request(app).post('/auth/login').send({ username: 'guard1', password: 'secret' });

      // Server is still alive and serving.
      const ok = await request(app).get('/health');
      expect(ok.status).toBe(200);
    });
  });

  describe('wrong HTTP method', () => {
    it('GET /auth/login (only POST is defined) → 404', async () => {
      const res = await request(app).get('/auth/login');
      expect(res.status).toBe(404);
    });
  });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('GET /auth/me (requireAuth)', () => {
  it('no token → 401 UNAUTHORIZED', async () => {
    const res = await request(app).get('/auth/me');
    expect(res.status).toBe(401);
    expect(res.body.statusCode).toBe('UNAUTHORIZED');
    expect(res.body.uiState).toBe('unauthorized');
  });

  it('garbage token → 401 INVALID_TOKEN', async () => {
    const res = await request(app).get('/auth/me').set('Cookie', 'vi_token=not-a-real-jwt');
    expect(res.status).toBe(401);
    expect(res.body.statusCode).toBe('INVALID_TOKEN');
  });

  it('expired token → 401 INVALID_TOKEN', async () => {
    const res = await request(app)
      .get('/auth/me')
      .set('Cookie', authCookie({}, { expiresIn: '-10s' }));
    expect(res.status).toBe(401);
    expect(res.body.statusCode).toBe('INVALID_TOKEN');
  });

  it('token signed with the wrong secret → 401 INVALID_TOKEN', async () => {
    const jwt = require('jsonwebtoken');
    const forged = jwt.sign({ userId: '1', username: 'guard1', role: 'guardia' }, 'attacker-secret');
    const res = await request(app).get('/auth/me').set('Cookie', `vi_token=${forged}`);
    expect(res.status).toBe(401);
    expect(res.body.statusCode).toBe('INVALID_TOKEN');
  });

  it('valid token → 200 with the decoded payload', async () => {
    const res = await request(app)
      .get('/auth/me')
      .set('Cookie', authCookie({ username: 'jefe1', role: 'jefe_operaciones' }));
    expect(res.status).toBe(200);
    expect(res.body.data).toMatchObject({ username: 'jefe1', role: 'jefe_operaciones' });
  });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('POST /auth/logout (requireAuth)', () => {
  it('no token → 401 (logout is itself protected)', async () => {
    const res = await request(app).post('/auth/logout');
    expect(res.status).toBe(401);
    expect(res.body.statusCode).toBe('UNAUTHORIZED');
  });

  it('valid token → 200 and clears the vi_token cookie', async () => {
    const res = await request(app).post('/auth/logout').set('Cookie', authCookie());
    expect(res.status).toBe(200);
    expect(res.body.statusCode).toBe('LOGOUT_SUCCESS');

    const cookies = res.headers['set-cookie'] as unknown as string[];
    // clearCookie emits vi_token with an immediate expiry.
    expect(cookies.some(c => /^vi_token=;/.test(c) || /Expires=Thu, 01 Jan 1970/i.test(c))).toBe(true);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('GET /auth/guards (requireAuth)', () => {
  it('no token → 401', async () => {
    const res = await request(app).get('/auth/guards');
    expect(res.status).toBe(401);
  });

  it('valid token → 200 with the kiosk user list', async () => {
    mockGuards.mockResolvedValue([{ username: 'guard1', fullName: 'Guard One' }]);
    const res = await request(app).get('/auth/guards').set('Cookie', authCookie());
    expect(res.status).toBe(200);
    expect(res.body.data).toEqual([{ username: 'guard1', fullName: 'Guard One' }]);
  });

  it('DB failure → 500 without crashing', async () => {
    mockGuards.mockRejectedValue(new Error('db down'));
    const res = await request(app).get('/auth/guards').set('Cookie', authCookie());
    expect(res.status).toBe(500);
    expect(res.body.statusCode).toBe('INTERNAL_ERROR');
  });
});
