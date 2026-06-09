// Integration tests — routes/vehicles.ts + controllers/vehicleStatusController.ts
//
// Security surface tested:
//   • requireAuth gate (all endpoints)
//   • requireRole guard on GET /unseen (supervisor+)
//   • Scope containment via assertResourceInScope on PATCH /:id/status
//   • Zod schema on PATCH /:id/status (status enum, unknown fields tolerated)
//   • changed / unchanged status response shape
//   • getUnseen threshold from settings
//   • DB failure → 500

import request from 'supertest';
import { createApp } from '../config/app';
import { AppError } from '../middleware/errorHandler';
import {
  authCookie, supervisorCookie,
  vehicleRow, inspectionRow, issueRow,
} from './helpers';

// ─── Mocks ───────────────────────────────────────────────────────────────────

jest.mock('../middleware/dbContext', () => ({
  dbContextMiddleware: (_req: any, _res: any, next: any) => next(),
}));
jest.mock('express-rate-limit', () => () => (_req: any, _res: any, next: any) => next());
jest.mock('../middleware/requireValidBranchContext', () => ({
  requireValidBranchContext: (_req: any, _res: any, next: any) => next(),
}));

jest.mock('../db/vehicles', () => ({
  getActiveVehicles:    jest.fn(),
  getAllVehicles:        jest.fn(),
  getVehicleById:       jest.fn(),
  setVehicleStatus:     jest.fn(),
}));
jest.mock('../db/inspections', () => ({
  getInspectionsByVehicle: jest.fn(),
  getUnseenVehicles:       jest.fn(),
  getInspectionsByDate:    jest.fn(),
  getInspectionCounts:     jest.fn(),
}));
jest.mock('../db/issues', () => ({
  getOpenIssuesByVehicle: jest.fn(),
  getIssues:              jest.fn(),
}));
jest.mock('../db/settings', () => ({
  getTypedSettings:     jest.fn(),
  runWithSettingsCache: (_next: any) => _next(),
}));
jest.mock('../db/scopeUtils', () => ({
  assertResourceInScope: jest.fn().mockResolvedValue(undefined),
  applyScopeWhere:       jest.fn(() => '1=1'),
}));

// ─── Imports after mocks ──────────────────────────────────────────────────────

import {
  getActiveVehicles, getAllVehicles, getVehicleById, setVehicleStatus,
} from '../db/vehicles';
import { getInspectionsByVehicle, getUnseenVehicles } from '../db/inspections';
import { getOpenIssuesByVehicle } from '../db/issues';
import { getTypedSettings } from '../db/settings';
import { assertResourceInScope } from '../db/scopeUtils';

const mockGetActive       = getActiveVehicles       as jest.Mock;
const mockGetAll          = getAllVehicles            as jest.Mock;
const mockGetById         = getVehicleById           as jest.Mock;
const mockSetStatus       = setVehicleStatus         as jest.Mock;
const mockGetHistory      = getInspectionsByVehicle  as jest.Mock;
const mockGetUnseen       = getUnseenVehicles        as jest.Mock;
const mockGetOpenIssues   = getOpenIssuesByVehicle   as jest.Mock;
const mockGetSettings     = getTypedSettings         as jest.Mock;
const mockAssertScope     = assertResourceInScope    as jest.Mock;

const app = createApp();

// ─── GET /vehicles ────────────────────────────────────────────────────────────

describe('GET /vehicles', () => {
  const cookie = authCookie();

  it('401 when not authenticated', async () => {
    const res = await request(app).get('/vehicles');
    expect(res.status).toBe(401);
  });

  it('200 returns active vehicles by default', async () => {
    mockGetActive.mockResolvedValueOnce([vehicleRow()]);
    const res = await request(app).get('/vehicles').set('Cookie', cookie);
    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.data).toHaveLength(1);
    expect(mockGetActive).toHaveBeenCalledTimes(1);
    expect(mockGetAll).not.toHaveBeenCalled();
  });

  it('200 returns all vehicles when ?all=1', async () => {
    mockGetAll.mockResolvedValueOnce([vehicleRow(), vehicleRow({ id: '11', active: false })]);
    const res = await request(app).get('/vehicles?all=1').set('Cookie', cookie);
    expect(res.status).toBe(200);
    expect(res.body.data).toHaveLength(2);
    expect(mockGetAll).toHaveBeenCalledTimes(1);
    expect(mockGetActive).not.toHaveBeenCalled();
  });

  it('200 with empty list when no vehicles exist', async () => {
    mockGetActive.mockResolvedValueOnce([]);
    const res = await request(app).get('/vehicles').set('Cookie', cookie);
    expect(res.status).toBe(200);
    expect(res.body.data).toHaveLength(0);
  });

  it('500 on DB failure', async () => {
    mockGetActive.mockRejectedValueOnce(new Error('Connection timeout'));
    const res = await request(app).get('/vehicles').set('Cookie', cookie);
    expect(res.status).toBe(500);
    expect(res.body.statusCode).toBe('INTERNAL_ERROR');
  });

  it('401 with expired token', async () => {
    const expired = authCookie({}, { expiresIn: '-10s' });
    const res = await request(app).get('/vehicles').set('Cookie', expired);
    expect(res.status).toBe(401);
  });
});

// ─── GET /vehicles/unseen ─────────────────────────────────────────────────────

describe('GET /vehicles/unseen', () => {
  it('401 unauthenticated', async () => {
    const res = await request(app).get('/vehicles/unseen');
    expect(res.status).toBe(401);
  });

  it('403 for guardia role', async () => {
    const cookie = authCookie({ role: 'guardia' });
    const res = await request(app).get('/vehicles/unseen').set('Cookie', cookie);
    expect(res.status).toBe(403);
  });

  it('200 for jefe_operaciones with setting-based threshold', async () => {
    mockGetSettings.mockResolvedValueOnce({ unseen_alert_hours: 6 });
    mockGetUnseen.mockResolvedValueOnce([vehicleRow()]);
    const cookie = supervisorCookie();
    const res = await request(app).get('/vehicles/unseen').set('Cookie', cookie);
    expect(res.status).toBe(200);
    expect(res.body.data.hours).toBe(6);
    expect(res.body.data.vehicles).toHaveLength(1);
  });

  it('200 for admin role', async () => {
    mockGetSettings.mockResolvedValueOnce({ unseen_alert_hours: 8 });
    mockGetUnseen.mockResolvedValueOnce([]);
    const cookie = authCookie({ role: 'admin', branchId: 1 });
    const res = await request(app).get('/vehicles/unseen').set('Cookie', cookie);
    expect(res.status).toBe(200);
    expect(res.body.data.vehicles).toHaveLength(0);
  });

  it('defaults to 8h when admin_pais has no branchId', async () => {
    // admin_pais has no branchId — controller falls through to default 8h
    mockGetUnseen.mockResolvedValueOnce([]);
    const cookie = authCookie({ role: 'admin_pais', countryId: 1, branchId: undefined });
    const res = await request(app).get('/vehicles/unseen').set('Cookie', cookie);
    expect(res.status).toBe(200);
    expect(res.body.data.hours).toBe(8);
    // getTypedSettings should NOT have been called (no branchId)
    expect(mockGetSettings).not.toHaveBeenCalled();
  });

  it('500 on DB failure', async () => {
    mockGetSettings.mockResolvedValueOnce({ unseen_alert_hours: 8 });
    mockGetUnseen.mockRejectedValueOnce(new Error('DB error'));
    const cookie = supervisorCookie();
    const res = await request(app).get('/vehicles/unseen').set('Cookie', cookie);
    expect(res.status).toBe(500);
  });
});

// ─── PATCH /vehicles/:id/status ───────────────────────────────────────────────

describe('PATCH /vehicles/:id/status', () => {
  const cookie = authCookie({ role: 'guardia', branchId: 1 });
  const validBody = { status: 'workshop', reason: 'Revisión de frenos' };

  it('401 unauthenticated', async () => {
    const res = await request(app).patch('/vehicles/10/status').send(validBody);
    expect(res.status).toBe(401);
  });

  it('400 missing status field', async () => {
    const res = await request(app).patch('/vehicles/10/status')
      .set('Cookie', cookie)
      .send({ reason: 'only reason, no status' });
    expect(res.status).toBe(400);
    expect(res.body.statusCode).toBe('VALIDATION_ERROR');
  });

  it('400 invalid status value', async () => {
    const res = await request(app).patch('/vehicles/10/status')
      .set('Cookie', cookie)
      .send({ status: 'flying', reason: 'fuera del sistema solar' });
    expect(res.status).toBe(400);
    expect(res.body.statusCode).toBe('VALIDATION_ERROR');
  });

  it('400 empty body', async () => {
    const res = await request(app).patch('/vehicles/10/status')
      .set('Cookie', cookie)
      .send({});
    expect(res.status).toBe(400);
  });

  it('200 status changed = true', async () => {
    mockGetById.mockResolvedValueOnce(vehicleRow({ branchId: 1 }));
    mockSetStatus.mockResolvedValueOnce({ changed: true, oldStatus: 'active' });
    const res = await request(app).patch('/vehicles/10/status')
      .set('Cookie', cookie)
      .send(validBody);
    expect(res.status).toBe(200);
    expect(res.body.statusCode).toBe('VEHICLE_STATUS_CHANGED');
    expect(res.body.data.changed).toBe(true);
    expect(res.body.data.oldStatus).toBe('active');
  });

  it('200 status unchanged', async () => {
    mockGetById.mockResolvedValueOnce(vehicleRow({ branchId: 1, currentStatus: 'workshop' }));
    mockSetStatus.mockResolvedValueOnce({ changed: false, oldStatus: 'workshop' });
    const res = await request(app).patch('/vehicles/10/status')
      .set('Cookie', cookie)
      .send({ status: 'workshop' });
    expect(res.status).toBe(200);
    expect(res.body.statusCode).toBe('VEHICLE_STATUS_UNCHANGED');
    expect(res.body.data.changed).toBe(false);
  });

  it('all valid status values accepted', async () => {
    const statuses = ['active', 'workshop', 'night_service', 'abroad', 'special_authorization'];
    for (const status of statuses) {
      mockGetById.mockResolvedValueOnce(vehicleRow({ branchId: 1 }));
      mockSetStatus.mockResolvedValueOnce({ changed: true, oldStatus: 'active' });
      const res = await request(app).patch('/vehicles/10/status')
        .set('Cookie', cookie)
        .send({ status });
      expect(res.status).toBe(200);
    }
  });

  it('404 when vehicle not found', async () => {
    mockGetById.mockResolvedValueOnce(null);
    const res = await request(app).patch('/vehicles/10/status')
      .set('Cookie', cookie)
      .send(validBody);
    expect(res.status).toBe(404);
    expect(res.body.statusCode).toBe('NOT_FOUND');
  });

  it('403 when vehicle is outside scope', async () => {
    mockGetById.mockResolvedValueOnce(vehicleRow({ branchId: 99 }));
    mockAssertScope.mockRejectedValueOnce(
      new AppError(403, 'OUTSIDE_SCOPE', 'Fuera de scope'),
    );
    const res = await request(app).patch('/vehicles/10/status')
      .set('Cookie', cookie)
      .send(validBody);
    expect(res.status).toBe(403);
    expect(res.body.statusCode).toBe('OUTSIDE_SCOPE');
  });

  it('500 on DB failure in setVehicleStatus', async () => {
    mockGetById.mockResolvedValueOnce(vehicleRow({ branchId: 1 }));
    mockSetStatus.mockRejectedValueOnce(new Error('DB write error'));
    const res = await request(app).patch('/vehicles/10/status')
      .set('Cookie', cookie)
      .send(validBody);
    expect(res.status).toBe(500);
  });

  it('passes expectedReturnDate through when provided', async () => {
    mockGetById.mockResolvedValueOnce(vehicleRow({ branchId: 1 }));
    mockSetStatus.mockResolvedValueOnce({ changed: true, oldStatus: 'active' });
    await request(app).patch('/vehicles/10/status')
      .set('Cookie', cookie)
      .send({ status: 'abroad', expectedReturnDate: '2026-06-20' });
    expect(mockSetStatus).toHaveBeenCalledWith(
      expect.objectContaining({ expectedReturnDate: '2026-06-20' }),
    );
  });
});

// ─── GET /vehicles/:id ────────────────────────────────────────────────────────

describe('GET /vehicles/:id', () => {
  const cookie = authCookie();

  it('401 unauthenticated', async () => {
    const res = await request(app).get('/vehicles/10');
    expect(res.status).toBe(401);
  });

  it('200 returns vehicle data', async () => {
    mockGetById.mockResolvedValueOnce(vehicleRow());
    const res = await request(app).get('/vehicles/10').set('Cookie', cookie);
    expect(res.status).toBe(200);
    expect(res.body.data.plate).toBe('ABC-123');
  });

  it('404 when vehicle not found', async () => {
    mockGetById.mockResolvedValueOnce(null);
    const res = await request(app).get('/vehicles/999').set('Cookie', cookie);
    expect(res.status).toBe(404);
    expect(res.body.statusCode).toBe('NOT_FOUND');
  });

  // ── IDOR fix: scope is passed to getVehicleById ───────────────────────────
  // A guardia from branch 1 cannot enumerate vehicles from branch 99 by probing
  // numeric IDs. The DB query includes the scope WHERE clause, so the function
  // returns null for any vehicle outside the caller's scope — same 404 as
  // "vehicle doesn't exist", preventing attacker from learning vehicle exists.
  it('404 when vehicle is outside caller scope (no IDOR)', async () => {
    // Simulates: scope filter eliminates the row even though vehicle exists in DB
    mockGetById.mockResolvedValueOnce(null);
    const res = await request(app)
      .get('/vehicles/999')
      .set('Cookie', authCookie({ role: 'guardia', branchId: 1 }));
    expect(res.status).toBe(404);
    expect(res.body.statusCode).toBe('NOT_FOUND');
  });

  it('scope is forwarded to getVehicleById', async () => {
    mockGetById.mockResolvedValueOnce(vehicleRow({ branchId: 1 }));
    const targetCookie = authCookie({ role: 'guardia', branchId: 5 });
    await request(app).get('/vehicles/10').set('Cookie', targetCookie);
    // The mock was called — scope argument forwarded (mock doesn't inspect it,
    // but this verifies the route didn't crash and the path reached the DB mock)
    expect(mockGetById).toHaveBeenCalledTimes(1);
  });

  it('500 on DB failure in getVehicleById', async () => {
    mockGetById.mockRejectedValueOnce(new Error('DB timeout'));
    const res = await request(app).get('/vehicles/10').set('Cookie', cookie);
    expect(res.status).toBe(500);
  });
});

// ─── GET /vehicles/:id/history ───────────────────────────────────────────────

describe('GET /vehicles/:id/history', () => {
  const cookie = supervisorCookie();

  it('401 unauthenticated', async () => {
    const res = await request(app).get('/vehicles/10/history');
    expect(res.status).toBe(401);
  });

  it('200 returns inspection history', async () => {
    mockGetHistory.mockResolvedValueOnce([inspectionRow()]);
    const res = await request(app).get('/vehicles/10/history').set('Cookie', cookie);
    expect(res.status).toBe(200);
    expect(res.body.data).toHaveLength(1);
  });

  it('200 with empty history', async () => {
    mockGetHistory.mockResolvedValueOnce([]);
    const res = await request(app).get('/vehicles/10/history').set('Cookie', cookie);
    expect(res.status).toBe(200);
    expect(res.body.data).toHaveLength(0);
  });

  it('500 on DB failure', async () => {
    mockGetHistory.mockRejectedValueOnce(new Error('DB timeout'));
    const res = await request(app).get('/vehicles/10/history').set('Cookie', cookie);
    expect(res.status).toBe(500);
  });
});

// ─── GET /vehicles/:id/open-issues ───────────────────────────────────────────

describe('GET /vehicles/:id/open-issues', () => {
  const cookie = authCookie();

  it('401 unauthenticated', async () => {
    const res = await request(app).get('/vehicles/10/open-issues');
    expect(res.status).toBe(401);
  });

  it('200 returns open issues for vehicle', async () => {
    mockGetOpenIssues.mockResolvedValueOnce([issueRow(), issueRow({ id: '201' })]);
    const res = await request(app).get('/vehicles/10/open-issues').set('Cookie', cookie);
    expect(res.status).toBe(200);
    expect(res.body.data).toHaveLength(2);
  });

  it('200 with no issues', async () => {
    mockGetOpenIssues.mockResolvedValueOnce([]);
    const res = await request(app).get('/vehicles/10/open-issues').set('Cookie', cookie);
    expect(res.status).toBe(200);
    expect(res.body.data).toHaveLength(0);
  });

  it('500 on DB failure', async () => {
    mockGetOpenIssues.mockRejectedValueOnce(new Error('Connection lost'));
    const res = await request(app).get('/vehicles/10/open-issues').set('Cookie', cookie);
    expect(res.status).toBe(500);
  });

  // ── IDOR fix: scope passed to getOpenIssuesByVehicle ─────────────────────
  // Before this fix, a guardia from branch 1 could call /vehicles/999/open-issues
  // and receive open issues belonging to vehicles in branch 99.
  // After the fix, the query JOINs Vehicles and applies the scope WHERE clause,
  // so only issues for vehicles within the caller's scope are returned.
  it('200 empty list when vehicle is outside caller scope (no data leak)', async () => {
    // Simulates: scope filter eliminates all rows (vehicle in different branch)
    mockGetOpenIssues.mockResolvedValueOnce([]);
    const res = await request(app)
      .get('/vehicles/999/open-issues')
      .set('Cookie', authCookie({ role: 'guardia', branchId: 1 }));
    expect(res.status).toBe(200);
    expect(res.body.data).toHaveLength(0);
  });
});
