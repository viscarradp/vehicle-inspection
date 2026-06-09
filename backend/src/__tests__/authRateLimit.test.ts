/**
 * Integration test — brute-force protection on POST /auth/login.
 *
 * Unlike auth.test.ts, this file does NOT mock express-rate-limit: the real
 * loginLimiter (max 8 failed attempts / 15 min, skipSuccessfulRequests) is the
 * thing under test. We simulate an attacker hammering the endpoint with bad
 * credentials and assert the 9th attempt is blocked with 429.
 */

import request from 'supertest';

jest.mock('../middleware/dbContext', () => ({
  dbContextMiddleware: (_req: any, _res: any, next: any) => next(),
}));
jest.mock('../db/users');
jest.mock('bcryptjs', () => ({
  hashSync: jest.fn(() => '$2a$12$mockdummyhashmockdummyhashmockdummyhashmockd'),
  compare: jest.fn().mockResolvedValue(false), // every attempt fails
}));

import { createApp } from '../config/app';
import { findUserByUsername } from '../db/users';

(findUserByUsername as jest.MockedFunction<typeof findUserByUsername>).mockResolvedValue(null);

const app = createApp();

beforeAll(() => {
  jest.spyOn(console, 'error').mockImplementation(() => {});
  jest.spyOn(console, 'warn').mockImplementation(() => {});
});

describe('POST /auth/login — brute-force limiter', () => {
  it('blocks the 9th failed attempt with 429 RATE_LIMITED', async () => {
    const attempt = () =>
      request(app).post('/auth/login').send({ username: 'guard1', password: 'wrong' });

    // 8 failed attempts are allowed (each a normal 401).
    for (let i = 0; i < 8; i++) {
      const res = await attempt();
      expect(res.status).toBe(401);
    }

    // The 9th is throttled.
    const blocked = await attempt();
    expect(blocked.status).toBe(429);
    expect(blocked.body.statusCode).toBe('RATE_LIMITED');
  });
});
