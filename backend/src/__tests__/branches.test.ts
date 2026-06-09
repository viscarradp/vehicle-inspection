// Integration tests — routes/branches.ts
//
// Security surface tested:
//   • requireAuth gate (all routes)
//   • requireBranchAdmin guard on writes (admin_pais, admin_global only)
//   • admin_pais always uses their own countryId when creating
//   • admin_global must supply countryId in body
//   • assertResourceInScope scope guard on update/activate/deactivate
//   • Missing required fields → 400
//   • DB failures → 500

import request from 'supertest';
import { createApp } from '../config/app';
import { AppError } from '../middleware/errorHandler';
import { authCookie, supervisorCookie, branchRow } from './helpers';

// ─── Mocks ───────────────────────────────────────────────────────────────────

jest.mock('../middleware/dbContext', () => ({
  dbContextMiddleware: (_req: any, _res: any, next: any) => next(),
}));
jest.mock('express-rate-limit', () => () => (_req: any, _res: any, next: any) => next());

jest.mock('../db/branches', () => ({
  getBranches:     jest.fn(),
  getBranchById:   jest.fn(),
  createBranch:    jest.fn(),
  updateBranch:    jest.fn(),
  setBranchActive: jest.fn(),
  getBranchTimezone: jest.fn().mockResolvedValue('America/Guatemala'),
}));
jest.mock('../db/scopeUtils', () => ({
  assertResourceInScope: jest.fn().mockResolvedValue(undefined),
  applyScopeWhere:       jest.fn(() => '1=1'),
}));

// ─── Imports after mocks ──────────────────────────────────────────────────────

import {
  getBranches, getBranchById, createBranch, updateBranch, setBranchActive,
} from '../db/branches';
import { assertResourceInScope } from '../db/scopeUtils';

const mockGetBranches  = getBranches        as jest.Mock;
const mockGetById      = getBranchById      as jest.Mock;
const mockCreate       = createBranch       as jest.Mock;
const mockUpdate       = updateBranch       as jest.Mock;
const mockSetActive    = setBranchActive    as jest.Mock;
const mockAssertScope  = assertResourceInScope as jest.Mock;

const app = createApp();

// ─── GET /branches ────────────────────────────────────────────────────────────

describe('GET /branches', () => {
  it('401 unauthenticated', async () => {
    const res = await request(app).get('/branches');
    expect(res.status).toBe(401);
  });

  it('200 guardia can list branches', async () => {
    mockGetBranches.mockResolvedValueOnce([branchRow()]);
    const cookie = authCookie({ role: 'guardia', branchId: 1 });
    const res = await request(app).get('/branches').set('Cookie', cookie);
    expect(res.status).toBe(200);
    expect(res.body.data).toHaveLength(1);
  });

  it('200 supervisor can list branches', async () => {
    mockGetBranches.mockResolvedValueOnce([branchRow(), branchRow({ id: 2 })]);
    const res = await request(app).get('/branches').set('Cookie', supervisorCookie());
    expect(res.status).toBe(200);
    expect(res.body.data).toHaveLength(2);
  });

  it('200 passes optional ?countryId filter to DB', async () => {
    mockGetBranches.mockResolvedValueOnce([]);
    const cookie = authCookie({ role: 'admin_global' });
    await request(app).get('/branches?countryId=2').set('Cookie', cookie);
    expect(mockGetBranches).toHaveBeenCalledWith(expect.any(Object), 2);
  });

  it('200 without countryId filter', async () => {
    mockGetBranches.mockResolvedValueOnce([]);
    const cookie = authCookie({ role: 'admin_global' });
    await request(app).get('/branches').set('Cookie', cookie);
    expect(mockGetBranches).toHaveBeenCalledWith(expect.any(Object), undefined);
  });

  it('500 on DB failure', async () => {
    mockGetBranches.mockRejectedValueOnce(new Error('DB timeout'));
    const res = await request(app).get('/branches').set('Cookie', authCookie());
    expect(res.status).toBe(500);
  });
});

// ─── POST /branches ───────────────────────────────────────────────────────────

describe('POST /branches', () => {
  it('401 unauthenticated', async () => {
    const res = await request(app).post('/branches').send({ code: 'S01', name: 'Test' });
    expect(res.status).toBe(401);
  });

  it('403 guardia cannot create branch', async () => {
    const res = await request(app).post('/branches')
      .set('Cookie', authCookie({ role: 'guardia' }))
      .send({ code: 'S01', name: 'Test' });
    expect(res.status).toBe(403);
  });

  it('403 jefe_operaciones cannot create branch', async () => {
    const res = await request(app).post('/branches')
      .set('Cookie', supervisorCookie())
      .send({ code: 'S01', name: 'Test' });
    expect(res.status).toBe(403);
  });

  it('403 admin cannot create branch', async () => {
    const res = await request(app).post('/branches')
      .set('Cookie', authCookie({ role: 'admin', branchId: 1 }))
      .send({ code: 'S01', name: 'Test' });
    expect(res.status).toBe(403);
  });

  it('400 missing code', async () => {
    const cookie = authCookie({ role: 'admin_pais', countryId: 1 });
    const res = await request(app).post('/branches')
      .set('Cookie', cookie)
      .send({ name: 'Only name' });
    expect(res.status).toBe(400);
    expect(res.body.statusCode).toBe('MISSING_FIELDS');
  });

  it('400 missing name', async () => {
    const cookie = authCookie({ role: 'admin_pais', countryId: 1 });
    const res = await request(app).post('/branches')
      .set('Cookie', cookie)
      .send({ code: 'S01' });
    expect(res.status).toBe(400);
    expect(res.body.statusCode).toBe('MISSING_FIELDS');
  });

  it('201 admin_pais creates branch in their own country', async () => {
    mockCreate.mockResolvedValueOnce(branchRow());
    const cookie = authCookie({ role: 'admin_pais', countryId: 1 });
    const res = await request(app).post('/branches')
      .set('Cookie', cookie)
      .send({ code: 'SUC02', name: 'Nueva Sucursal', address: 'Calle 5' });
    expect(res.status).toBe(201);
    expect(res.body.statusCode).toBe('BRANCH_CREATED');
    expect(mockCreate).toHaveBeenCalledWith(
      expect.objectContaining({ countryId: 1, code: 'SUC02', name: 'Nueva Sucursal' }),
    );
  });

  it('admin_pais cannot override countryId — forced from token', async () => {
    mockCreate.mockResolvedValueOnce(branchRow());
    const cookie = authCookie({ role: 'admin_pais', countryId: 1 });
    await request(app).post('/branches')
      .set('Cookie', cookie)
      .send({ code: 'S99', name: 'Hack Sucursal', countryId: 99 });
    // Despite sending countryId=99, createBranch should use the token's countryId=1
    expect(mockCreate).toHaveBeenCalledWith(
      expect.objectContaining({ countryId: 1 }),
    );
  });

  it('400 admin_global missing countryId in body', async () => {
    const cookie = authCookie({ role: 'admin_global', branchId: undefined });
    const res = await request(app).post('/branches')
      .set('Cookie', cookie)
      .send({ code: 'S01', name: 'Test' }); // no countryId
    expect(res.status).toBe(400);
    expect(res.body.statusCode).toBe('MISSING_COUNTRY');
  });

  it('201 admin_global creates branch with explicit countryId', async () => {
    mockCreate.mockResolvedValueOnce(branchRow({ countryId: 3 }));
    const cookie = authCookie({ role: 'admin_global', branchId: undefined });
    const res = await request(app).post('/branches')
      .set('Cookie', cookie)
      .send({ code: 'S03', name: 'Sucursal GT', countryId: 3 });
    expect(res.status).toBe(201);
    expect(mockCreate).toHaveBeenCalledWith(
      expect.objectContaining({ countryId: 3 }),
    );
  });

  it('500 on DB failure', async () => {
    mockCreate.mockRejectedValueOnce(new Error('Unique constraint'));
    const cookie = authCookie({ role: 'admin_pais', countryId: 1 });
    const res = await request(app).post('/branches')
      .set('Cookie', cookie)
      .send({ code: 'S01', name: 'Test' });
    expect(res.status).toBe(500);
  });
});

// ─── PUT /branches/:id ────────────────────────────────────────────────────────

describe('PUT /branches/:id', () => {
  const adminPaisCookie = authCookie({ role: 'admin_pais', countryId: 1 });

  it('403 non-admin-pais role', async () => {
    const res = await request(app).put('/branches/1')
      .set('Cookie', authCookie({ role: 'admin', branchId: 1 }))
      .send({ name: 'Updated' });
    expect(res.status).toBe(403);
  });

  it('200 admin_pais updates branch in their scope', async () => {
    mockGetById.mockResolvedValueOnce(branchRow({ id: 1 }));
    mockUpdate.mockResolvedValueOnce(undefined);
    const res = await request(app).put('/branches/1')
      .set('Cookie', adminPaisCookie)
      .send({ name: 'Updated Name' });
    expect(res.status).toBe(200);
    expect(res.body.statusCode).toBe('BRANCH_UPDATED');
  });

  it('403 scope guard rejects branch from another country', async () => {
    mockGetById.mockResolvedValueOnce(branchRow({ id: 1, countryId: 99 }));
    mockAssertScope.mockRejectedValueOnce(
      new AppError(403, 'OUTSIDE_SCOPE', 'Fuera de scope'),
    );
    const res = await request(app).put('/branches/1')
      .set('Cookie', adminPaisCookie)
      .send({ name: 'Hacked Name' });
    expect(res.status).toBe(403);
  });

  it('404 branch not found', async () => {
    mockGetById.mockRejectedValueOnce(new AppError(404, 'NOT_FOUND', 'Sucursal no encontrada'));
    const res = await request(app).put('/branches/999')
      .set('Cookie', adminPaisCookie)
      .send({ name: 'Ghost' });
    expect(res.status).toBe(404);
  });
});

// ─── PATCH /branches/:id/activate|deactivate ─────────────────────────────────

describe('PATCH /branches/:id/activate|deactivate', () => {
  const adminPaisCookie = authCookie({ role: 'admin_pais', countryId: 1 });

  it('200 activate branch', async () => {
    mockGetById.mockResolvedValueOnce(branchRow({ active: false }));
    mockSetActive.mockResolvedValueOnce(undefined);
    const res = await request(app).patch('/branches/1/activate')
      .set('Cookie', adminPaisCookie);
    expect(res.status).toBe(200);
    expect(res.body.statusCode).toBe('BRANCH_ACTIVATED');
    expect(mockSetActive).toHaveBeenCalledWith(1, true);
  });

  it('200 deactivate branch', async () => {
    mockGetById.mockResolvedValueOnce(branchRow({ active: true }));
    mockSetActive.mockResolvedValueOnce(undefined);
    const res = await request(app).patch('/branches/1/deactivate')
      .set('Cookie', adminPaisCookie);
    expect(res.status).toBe(200);
    expect(res.body.statusCode).toBe('BRANCH_DEACTIVATED');
    expect(mockSetActive).toHaveBeenCalledWith(1, false);
  });

  it('403 scope guard rejects branch from another country', async () => {
    mockGetById.mockResolvedValueOnce(branchRow({ id: 1, countryId: 99 }));
    mockAssertScope.mockRejectedValueOnce(
      new AppError(403, 'OUTSIDE_SCOPE', 'Fuera de scope'),
    );
    const res = await request(app).patch('/branches/1/activate')
      .set('Cookie', adminPaisCookie);
    expect(res.status).toBe(403);
  });

  it('500 on DB failure', async () => {
    mockGetById.mockResolvedValueOnce(branchRow());
    mockSetActive.mockRejectedValueOnce(new Error('DB error'));
    const res = await request(app).patch('/branches/1/deactivate')
      .set('Cookie', adminPaisCookie);
    expect(res.status).toBe(500);
  });
});
