// Integration tests — routes/reports.ts
//
// Security surface tested:
//   • requireAuth + requireRole('jefe_operaciones', ...) gate
//   • requireValidBranchContext passthrough
//   • GET /reports/daily — date param, shift filter, countInspections aggregation
//   • GET /reports/vehicle/:vehicleId — history
//   • GET /reports/open-issues
//   • GET /reports/no-review — ?days param, filtering by lastInspectionDate
//   • GET /reports/export/daily — generateDailyExcel called, response headers set

import request from 'supertest';
import { createApp } from '../config/app';
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

jest.mock('../db/inspections', () => ({
  getInspectionsByDate:    jest.fn(),
  getInspectionsByVehicle: jest.fn(),
  getInspectionCounts:     jest.fn(),
  getUnseenVehicles:       jest.fn(),
}));
jest.mock('../db/issues', () => ({
  getIssues:              jest.fn(),
  getOpenIssuesByVehicle: jest.fn(),
}));
jest.mock('../db/vehicles', () => ({
  getActiveVehicles:  jest.fn(),
  getAllVehicles:      jest.fn(),
  getVehicleById:     jest.fn(),
  setVehicleStatus:   jest.fn(),
}));
jest.mock('../services/exportService', () => ({
  generateDailyExcel: jest.fn(),
}));

// ─── Imports after mocks ──────────────────────────────────────────────────────

import { getInspectionsByDate, getInspectionsByVehicle } from '../db/inspections';
import { getIssues } from '../db/issues';
import { getActiveVehicles } from '../db/vehicles';
import { generateDailyExcel } from '../services/exportService';

const mockGetByDate    = getInspectionsByDate    as jest.Mock;
const mockGetByVehicle = getInspectionsByVehicle as jest.Mock;
const mockGetIssues    = getIssues               as jest.Mock;
const mockGetActive    = getActiveVehicles       as jest.Mock;
const mockExcel        = generateDailyExcel      as jest.Mock;

const app = createApp();

// ─── Auth/role guard ──────────────────────────────────────────────────────────

describe('Reports auth/role guard', () => {
  it('401 unauthenticated on GET /reports/daily', async () => {
    const res = await request(app).get('/reports/daily');
    expect(res.status).toBe(401);
  });

  it('403 guardia cannot access reports', async () => {
    // No mock needed — requireRole blocks before getInspectionsByDate is called
    const res = await request(app).get('/reports/daily')
      .set('Cookie', authCookie({ role: 'guardia' }));
    expect(res.status).toBe(403);
  });
});

// ─── GET /reports/daily ───────────────────────────────────────────────────────

describe('GET /reports/daily', () => {
  const cookie = supervisorCookie();

  it('200 returns daily report with aggregate counts', async () => {
    const inspections = [
      inspectionRow({ status: 'reviewed_ok' }),
      inspectionRow({ id: '101', status: 'serious_issue' }),
      inspectionRow({ id: '102', status: 'reviewed_observation' }),
      inspectionRow({ id: '103', status: 'not_returned' }),
    ];
    mockGetByDate.mockResolvedValueOnce(inspections);
    const res = await request(app).get('/reports/daily?date=2026-06-09')
      .set('Cookie', cookie);
    expect(res.status).toBe(200);
    expect(res.body.data.counts.total).toBe(4);
    expect(res.body.data.counts.reviewed).toBe(2);   // reviewed_ok + reviewed_observation
    expect(res.body.data.counts.issues).toBe(1);     // serious_issue
    expect(res.body.data.counts.notReturned).toBe(1);
  });

  it('200 passes date param to DB function', async () => {
    mockGetByDate.mockResolvedValueOnce([]);
    await request(app).get('/reports/daily?date=2026-01-15').set('Cookie', cookie);
    expect(mockGetByDate).toHaveBeenCalledWith('2026-01-15', expect.any(Object), undefined);
  });

  it('200 passes shift filter when provided', async () => {
    mockGetByDate.mockResolvedValueOnce([]);
    await request(app).get('/reports/daily?date=2026-06-09&shift=morning').set('Cookie', cookie);
    expect(mockGetByDate).toHaveBeenCalledWith('2026-06-09', expect.any(Object), 'morning');
  });

  it('200 no ?date param → defaults to today', async () => {
    mockGetByDate.mockResolvedValueOnce([]);
    await request(app).get('/reports/daily').set('Cookie', cookie);
    // date should be a date string, e.g. '2026-06-09'
    expect(mockGetByDate).toHaveBeenCalledWith(
      expect.stringMatching(/^\d{4}-\d{2}-\d{2}$/),
      expect.any(Object),
      undefined,
    );
  });

  it('200 guardNames deduplicates across inspections', async () => {
    const inspections = [
      inspectionRow({ guardName: 'Alice' }),
      inspectionRow({ id: '101', guardName: 'Bob' }),
      inspectionRow({ id: '102', guardName: 'Alice' }), // duplicate
    ];
    mockGetByDate.mockResolvedValueOnce(inspections);
    const res = await request(app).get('/reports/daily').set('Cookie', cookie);
    expect(res.status).toBe(200);
    expect(res.body.data.guardNames).toHaveLength(2);
    expect(res.body.data.guardNames).toContain('Alice');
    expect(res.body.data.guardNames).toContain('Bob');
  });

  it('200 empty report when no inspections', async () => {
    mockGetByDate.mockResolvedValueOnce([]);
    const res = await request(app).get('/reports/daily').set('Cookie', cookie);
    expect(res.status).toBe(200);
    expect(res.body.data.counts.total).toBe(0);
    expect(res.body.data.inspections).toHaveLength(0);
  });

  it('500 on DB failure', async () => {
    mockGetByDate.mockRejectedValueOnce(new Error('DB timeout'));
    const res = await request(app).get('/reports/daily').set('Cookie', cookie);
    expect(res.status).toBe(500);
  });
});

// ─── GET /reports/vehicle/:vehicleId ─────────────────────────────────────────

describe('GET /reports/vehicle/:vehicleId', () => {
  const cookie = supervisorCookie();

  it('200 returns vehicle inspection history', async () => {
    mockGetByVehicle.mockResolvedValueOnce([inspectionRow(), inspectionRow({ id: '101' })]);
    const res = await request(app).get('/reports/vehicle/10').set('Cookie', cookie);
    expect(res.status).toBe(200);
    expect(res.body.data).toHaveLength(2);
  });

  it('200 empty history', async () => {
    mockGetByVehicle.mockResolvedValueOnce([]);
    const res = await request(app).get('/reports/vehicle/999').set('Cookie', cookie);
    expect(res.status).toBe(200);
    expect(res.body.data).toHaveLength(0);
  });

  it('500 on DB failure', async () => {
    mockGetByVehicle.mockRejectedValueOnce(new Error('DB error'));
    const res = await request(app).get('/reports/vehicle/10').set('Cookie', cookie);
    expect(res.status).toBe(500);
  });
});

// ─── GET /reports/open-issues ────────────────────────────────────────────────

describe('GET /reports/open-issues', () => {
  const cookie = supervisorCookie();

  it('200 returns all open issues scoped to actor', async () => {
    mockGetIssues.mockResolvedValueOnce([issueRow(), issueRow({ id: '201' })]);
    const res = await request(app).get('/reports/open-issues').set('Cookie', cookie);
    expect(res.status).toBe(200);
    expect(res.body.data).toHaveLength(2);
  });

  it('passes status=open to DB function', async () => {
    mockGetIssues.mockResolvedValueOnce([]);
    await request(app).get('/reports/open-issues').set('Cookie', cookie);
    expect(mockGetIssues).toHaveBeenCalledWith({ status: 'open' }, expect.any(Object));
  });

  it('500 on DB failure', async () => {
    mockGetIssues.mockRejectedValueOnce(new Error('DB error'));
    const res = await request(app).get('/reports/open-issues').set('Cookie', cookie);
    expect(res.status).toBe(500);
  });
});

// ─── GET /reports/no-review ──────────────────────────────────────────────────

describe('GET /reports/no-review', () => {
  const cookie = supervisorCookie();

  // La ruta calcula el cutoff con `new Date()` real, así que las fechas del test
  // se construyen relativas a hoy — de lo contrario el test se rompe según el día
  // en que se ejecute (cutoff = hoy - days).
  const daysAgo = (n: number): string => {
    const d = new Date();
    d.setDate(d.getDate() - n);
    return d.toISOString();
  };

  it('200 filters vehicles without recent inspection', async () => {
    const vehicles = [
      vehicleRow({ lastInspectionDate: daysAgo(10) } as any),            // suficientemente viejo
      vehicleRow({ id: '11', lastInspectionDate: daysAgo(0) } as any),   // reciente (hoy)
      vehicleRow({ id: '12' }),                                          // sin lastInspectionDate
    ];
    mockGetActive.mockResolvedValueOnce(vehicles);
    const res = await request(app).get('/reports/no-review?days=3').set('Cookie', cookie);
    expect(res.status).toBe(200);
    // Only vehicles[0] and vehicles[2] should be returned
    expect(res.body.data).toHaveLength(2);
  });

  it('200 with default 3 days when no ?days param', async () => {
    mockGetActive.mockResolvedValueOnce([]);
    const res = await request(app).get('/reports/no-review').set('Cookie', cookie);
    expect(res.status).toBe(200);
  });

  it('500 on DB failure', async () => {
    mockGetActive.mockRejectedValueOnce(new Error('DB error'));
    const res = await request(app).get('/reports/no-review').set('Cookie', cookie);
    expect(res.status).toBe(500);
  });
});

// ─── GET /reports/export/daily ───────────────────────────────────────────────

describe('GET /reports/export/daily', () => {
  const cookie = supervisorCookie();
  const excelBuffer = Buffer.from('fake-excel-bytes');

  it('401 unauthenticated', async () => {
    const res = await request(app).get('/reports/export/daily');
    expect(res.status).toBe(401);
  });

  it('403 guardia cannot export', async () => {
    const res = await request(app).get('/reports/export/daily')
      .set('Cookie', authCookie({ role: 'guardia' }));
    expect(res.status).toBe(403);
  });

  it('200 returns Excel binary with correct headers', async () => {
    mockExcel.mockResolvedValueOnce(excelBuffer);
    const res = await request(app).get('/reports/export/daily?date=2026-06-09')
      .set('Cookie', cookie);
    expect(res.status).toBe(200);
    expect(res.headers['content-type']).toContain('spreadsheetml');
    expect(res.headers['content-disposition']).toContain('reporte_2026-06-09.xlsx');
  });

  it('passes date and shift to generateDailyExcel', async () => {
    mockExcel.mockResolvedValueOnce(excelBuffer);
    await request(app).get('/reports/export/daily?date=2026-06-01&shift=afternoon')
      .set('Cookie', cookie);
    expect(mockExcel).toHaveBeenCalledWith('2026-06-01', expect.any(Object), 'afternoon');
  });

  it('500 on generateDailyExcel failure', async () => {
    mockExcel.mockRejectedValueOnce(new Error('Excel generation failed'));
    const res = await request(app).get('/reports/export/daily')
      .set('Cookie', cookie);
    expect(res.status).toBe(500);
  });
});
