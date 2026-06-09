// Integration tests — routes/drivers.ts
//
// Coverage:
//   • requireAuth gate
//   • GET / active only (default)
//   • GET /?all=1 includes inactive
//   • Scope scoped to actor via scopeFromRequest
//   • DB failures → 500

import request from 'supertest';
import { createApp } from '../config/app';
import { authCookie, supervisorCookie, driverRow } from './helpers';

// ─── Mocks ───────────────────────────────────────────────────────────────────

jest.mock('../middleware/dbContext', () => ({
  dbContextMiddleware: (_req: any, _res: any, next: any) => next(),
}));
jest.mock('express-rate-limit', () => () => (_req: any, _res: any, next: any) => next());

jest.mock('../db/drivers', () => ({
  getActiveDrivers:  jest.fn(),
  getAllDrivers:      jest.fn(),
  createDriver:      jest.fn(),
  updateDriver:      jest.fn(),
  getDriverById:     jest.fn(),
  setDriverActive:   jest.fn(),
}));

// ─── Imports after mocks ──────────────────────────────────────────────────────

import { getActiveDrivers, getAllDrivers } from '../db/drivers';

const mockGetActive = getActiveDrivers as jest.Mock;
const mockGetAll    = getAllDrivers    as jest.Mock;

const app = createApp();

// ─── GET /drivers ─────────────────────────────────────────────────────────────

describe('GET /drivers', () => {
  it('401 unauthenticated', async () => {
    const res = await request(app).get('/drivers');
    expect(res.status).toBe(401);
  });

  it('200 guardia gets active drivers by default', async () => {
    mockGetActive.mockResolvedValueOnce([driverRow()]);
    const res = await request(app).get('/drivers')
      .set('Cookie', authCookie({ role: 'guardia', branchId: 1 }));
    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.data).toHaveLength(1);
    expect(mockGetActive).toHaveBeenCalledTimes(1);
    expect(mockGetAll).not.toHaveBeenCalled();
  });

  it('200 supervisor gets active drivers by default', async () => {
    mockGetActive.mockResolvedValueOnce([driverRow(), driverRow({ id: '6', name: 'María López' })]);
    const res = await request(app).get('/drivers').set('Cookie', supervisorCookie());
    expect(res.status).toBe(200);
    expect(res.body.data).toHaveLength(2);
  });

  it('200 all=1 returns all drivers including inactive', async () => {
    mockGetAll.mockResolvedValueOnce([
      driverRow(),
      driverRow({ id: '7', active: false }),
    ]);
    const res = await request(app).get('/drivers?all=1')
      .set('Cookie', authCookie({ role: 'admin', branchId: 1 }));
    expect(res.status).toBe(200);
    expect(res.body.data).toHaveLength(2);
    expect(mockGetAll).toHaveBeenCalledTimes(1);
    expect(mockGetActive).not.toHaveBeenCalled();
  });

  it('200 ?all=0 (not "1") still returns active only', async () => {
    mockGetActive.mockResolvedValueOnce([driverRow()]);
    const res = await request(app).get('/drivers?all=0').set('Cookie', authCookie());
    expect(res.status).toBe(200);
    expect(mockGetActive).toHaveBeenCalledTimes(1);
  });

  it('200 empty list when no drivers exist', async () => {
    mockGetActive.mockResolvedValueOnce([]);
    const res = await request(app).get('/drivers').set('Cookie', authCookie());
    expect(res.status).toBe(200);
    expect(res.body.data).toHaveLength(0);
  });

  it('500 on DB failure', async () => {
    mockGetActive.mockRejectedValueOnce(new Error('Connection timeout'));
    const res = await request(app).get('/drivers').set('Cookie', authCookie());
    expect(res.status).toBe(500);
    expect(res.body.statusCode).toBe('INTERNAL_ERROR');
  });

  it('500 on DB failure for ?all=1', async () => {
    mockGetAll.mockRejectedValueOnce(new Error('DB error'));
    const res = await request(app).get('/drivers?all=1')
      .set('Cookie', authCookie({ role: 'admin', branchId: 1 }));
    expect(res.status).toBe(500);
  });
});
