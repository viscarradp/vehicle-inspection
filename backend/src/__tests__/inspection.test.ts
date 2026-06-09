/**
 * Integration tests — Inspection controller & routes.
 *
 *   GET  /inspections/dashboard   → getGuardDashboard
 *   POST /inspections             → createOrUpdateInspection
 *   PATCH /inspections/:id        → editInspection (supervisor only)
 *   GET  /inspections/:id         → getInspection
 *
 * All routes require requireAuth. editInspection additionally restricts to
 * supervisor roles at the controller level (jefe_operaciones/admin/admin_pais/
 * admin_global). There is no requireRole middleware on the route itself.
 *
 * Mocking strategy:
 *   - dbContext / rate-limit              → passthrough (infrastructure, not under test)
 *   - ../db/inspections                   → full mock, drives happy/error paths
 *   - ../db/vehicles                      → full mock
 *   - ../db/issues                        → full mock
 *   - ../db/audit                         → full mock
 *   - ../db/settings                      → returns deterministic TypedSettings
 *   - ../db/branches (getBranchTimezone)  → returns 'America/Guatemala'
 *   - ../db/timezone                      → pure helpers mocked for determinism
 *   - ../services/mileageService          → full mock (controls warning triggers)
 *   - ../db/scopeUtils (assertResourceInScope) → no-op by default; throws on demand
 *
 * The timezone mock is critical: without it, shift/date calculations depend on
 * when the test runs (morning vs. night), making assertions non-deterministic.
 * All tests assume shiftContext() resolves to { localDate: '2026-06-09', shift: 'morning' }.
 */

import request from 'supertest';

// ── Mocks (hoisted before all imports) ───────────────────────────────────────

jest.mock('../middleware/dbContext', () => ({
  dbContextMiddleware: (_req: any, _res: any, next: any) => next(),
}));

jest.mock('express-rate-limit', () => ({
  __esModule: true,
  default: () => (_req: any, _res: any, next: any) => next(),
}));

jest.mock('../db/inspections');
jest.mock('../db/vehicles');
jest.mock('../db/issues');
jest.mock('../db/audit');

jest.mock('../db/settings', () => ({
  getTypedSettings:     jest.fn(),
  runWithSettingsCache: (_next: any) => _next(),
}));

jest.mock('../db/branches', () => ({
  getBranchTimezone: jest.fn(),
}));

// Pure timezone helpers mocked for determinism. The controller uses them only
// through shiftContext(), so we pin: localDate='2026-06-09', shift='morning'.
jest.mock('../db/timezone', () => ({
  getDateInTimezone:   jest.fn(() => '2026-06-09'),
  getHourInTimezone:   jest.fn(() => 8),
  resolveShift:        jest.fn(() => 'morning'),
  getOperationalDate:  jest.fn(() => '2026-06-09'),
}));

jest.mock('../services/mileageService', () => ({
  validateMileage: jest.fn(),
}));

jest.mock('../db/scopeUtils', () => ({
  assertResourceInScope: jest.fn().mockResolvedValue(undefined),
  applyScopeWhere:       jest.fn(() => '1=1'),
}));

// ─────────────────────────────────────────────────────────────────────────────

import { createApp } from '../config/app';
import {
  createInspection, updateInspection, getInspectionById,
  getInspectionForShift, getInspectionsByDate,
} from '../db/inspections';
import {
  getActiveVehicles, getVehicleById, refreshVehicleMileage,
  setOpenIssuesFlag, setVehicleStatus,
} from '../db/vehicles';
import { createIssue } from '../db/issues';
import { createAuditLog } from '../db/audit';
import { getTypedSettings } from '../db/settings';
import { getBranchTimezone } from '../db/branches';
import { validateMileage } from '../services/mileageService';
import { authCookie, supervisorCookie, vehicleRow, inspectionRow, issueRow, defaultSettings } from './helpers';

const mockCreateInspection     = createInspection        as jest.MockedFunction<typeof createInspection>;
const mockUpdateInspection     = updateInspection        as jest.MockedFunction<typeof updateInspection>;
const mockGetInspectionById    = getInspectionById       as jest.MockedFunction<typeof getInspectionById>;
const mockGetInspectionForShift = getInspectionForShift  as jest.MockedFunction<typeof getInspectionForShift>;
const mockGetInspectionsByDate = getInspectionsByDate    as jest.MockedFunction<typeof getInspectionsByDate>;
const mockGetActiveVehicles    = getActiveVehicles       as jest.MockedFunction<typeof getActiveVehicles>;
const mockGetVehicleById       = getVehicleById          as jest.MockedFunction<typeof getVehicleById>;
const mockRefreshMileage       = refreshVehicleMileage   as jest.MockedFunction<typeof refreshVehicleMileage>;
const mockSetOpenIssuesFlag    = setOpenIssuesFlag       as jest.MockedFunction<typeof setOpenIssuesFlag>;
const mockSetVehicleStatus     = setVehicleStatus        as jest.MockedFunction<typeof setVehicleStatus>;
const mockCreateIssue          = createIssue             as jest.MockedFunction<typeof createIssue>;
const mockCreateAuditLog       = createAuditLog          as jest.MockedFunction<typeof createAuditLog>;
const mockGetTypedSettings     = getTypedSettings        as jest.MockedFunction<typeof getTypedSettings>;
const mockGetBranchTimezone    = getBranchTimezone       as jest.MockedFunction<typeof getBranchTimezone>;
const mockValidateMileage      = validateMileage         as jest.MockedFunction<typeof validateMileage>;

const app = createApp();

// Silence expected server-side 500 logs so test output is clean.
beforeAll(() => {
  jest.spyOn(console, 'error').mockImplementation(() => {});
  jest.spyOn(console, 'warn').mockImplementation(() => {});
});
afterAll(() => {
  (console.error as jest.Mock).mockRestore?.();
  (console.warn  as jest.Mock).mockRestore?.();
});

// ── Happy-path defaults — individual tests override what they care about ──────
beforeEach(() => {
  mockGetBranchTimezone.mockResolvedValue('America/Guatemala');
  mockGetTypedSettings.mockResolvedValue(defaultSettings() as any);
  mockGetActiveVehicles.mockResolvedValue([vehicleRow()]);
  mockGetInspectionsByDate.mockResolvedValue([]);
  mockGetVehicleById.mockResolvedValue(vehicleRow());
  mockGetInspectionForShift.mockResolvedValue(null);       // no existing record by default
  mockCreateInspection.mockResolvedValue({ id: '100' });
  mockUpdateInspection.mockResolvedValue(undefined);
  mockGetInspectionById.mockResolvedValue(inspectionRow());
  mockRefreshMileage.mockResolvedValue(undefined);
  mockSetOpenIssuesFlag.mockResolvedValue(undefined);
  mockSetVehicleStatus.mockResolvedValue(undefined);
  mockCreateIssue.mockResolvedValue({ id: '200' });
  mockCreateAuditLog.mockResolvedValue(undefined);
  // Default: mileage is normal, no warning.
  mockValidateMileage.mockResolvedValue({
    hasWarning: false, warningType: 'none', previousMileage: 50000, difference: 1000,
  });
});

// ─── Minimal valid body for a "received" inspection ──────────────────────────
const receivedBody = {
  vehicleId:            '10',
  plate:                'ABC-123',
  returnStatus:         'received',
  finalDriverId:        '5',
  mileage:              51000,
  fuelLevel:            'full',
  cleanlinessStatus:    'clean',
  toolsGeneralStatus:   'ok',
  exteriorGeneralStatus:'ok',
  interiorGeneralStatus:'ok',
};

// ═════════════════════════════════════════════════════════════════════════════
describe('GET /inspections/dashboard', () => {
  describe('authentication', () => {
    it('no token → 401', async () => {
      const res = await request(app).get('/inspections/dashboard');
      expect(res.status).toBe(401);
    });
  });

  describe('user configuration', () => {
    it('user without branchId → 400 NO_BRANCH', async () => {
      const res = await request(app)
        .get('/inspections/dashboard')
        .set('Cookie', authCookie({ role: 'admin_global', branchId: undefined }));
      expect(res.status).toBe(400);
      expect(res.body.statusCode).toBe('NO_BRANCH');
    });
  });

  describe('happy path', () => {
    it('returns full GuardDashboard structure with branchId, localDate, shift, timezone, counts', async () => {
      const res = await request(app)
        .get('/inspections/dashboard')
        .set('Cookie', authCookie());
      expect(res.status).toBe(200);
      expect(res.body.data).toMatchObject({
        branchId:  1,
        localDate: '2026-06-09',
        shift:     'morning',
        timezone:  'America/Guatemala',
        guardName: 'Guard One',
        counts:    { total: 1, seen: 0, unseen: 1 },
      });
    });

    it('vehicle already inspected today shows todayRecord.kind = returnStatus', async () => {
      mockGetInspectionsByDate.mockResolvedValue([
        inspectionRow({ vehicleId: '10', returnStatus: 'received', status: 'reviewed_ok' }),
      ]);
      const res = await request(app)
        .get('/inspections/dashboard')
        .set('Cookie', authCookie());
      const card = res.body.data.vehicles[0];
      expect(card.todayRecord.kind).toBe('received');
      expect(card.todayRecord.inspectionId).toBe('100');
      expect(card.todayRecord.inspectionStatus).toBe('reviewed_ok');
    });

    it('unseen count only includes active-status vehicles without inspection today', async () => {
      // Two active vehicles, one in 'workshop' (special status), zero inspections today.
      mockGetActiveVehicles.mockResolvedValue([
        vehicleRow({ id: '10', currentStatus: 'active' }),
        vehicleRow({ id: '11', currentStatus: 'workshop' }),
      ]);
      mockGetInspectionsByDate.mockResolvedValue([]);
      const res = await request(app)
        .get('/inspections/dashboard')
        .set('Cookie', authCookie());
      // Only the 'active' vehicle counts as unseen.
      expect(res.body.data.counts.unseen).toBe(1);
    });

    it('noReviewAlert is true when vehicle has no lastInspectionDate', async () => {
      mockGetActiveVehicles.mockResolvedValue([vehicleRow({ lastInspectionDate: undefined })]);
      const res = await request(app)
        .get('/inspections/dashboard')
        .set('Cookie', authCookie());
      expect(res.body.data.vehicles[0].noReviewAlert).toBe(true);
    });

    it('noReviewAlert is true when daysSinceLastReview >= threshold (3 days)', async () => {
      // Last inspection 3 days ago from '2026-06-09' → '2026-06-06'
      mockGetActiveVehicles.mockResolvedValue([
        vehicleRow({ lastInspectionDate: '2026-06-06T10:00:00.000Z' }),
      ]);
      const res = await request(app)
        .get('/inspections/dashboard')
        .set('Cookie', authCookie());
      expect(res.body.data.vehicles[0].noReviewAlert).toBe(true);
    });

    it('noReviewAlert is false when reviewed recently (yesterday)', async () => {
      mockGetActiveVehicles.mockResolvedValue([
        vehicleRow({ lastInspectionDate: '2026-06-08T10:00:00.000Z' }),
      ]);
      const res = await request(app)
        .get('/inspections/dashboard')
        .set('Cookie', authCookie());
      expect(res.body.data.vehicles[0].noReviewAlert).toBe(false);
    });

    it('seen count increments for each received inspection today', async () => {
      mockGetActiveVehicles.mockResolvedValue([
        vehicleRow({ id: '10' }),
        vehicleRow({ id: '11', plate: 'XYZ-999' }),
      ]);
      mockGetInspectionsByDate.mockResolvedValue([
        inspectionRow({ vehicleId: '10', returnStatus: 'received' }),
        inspectionRow({ id: '101', vehicleId: '11', plate: 'XYZ-999', returnStatus: 'received' }),
      ]);
      const res = await request(app)
        .get('/inspections/dashboard')
        .set('Cookie', authCookie());
      expect(res.body.data.counts.seen).toBe(2);
      expect(res.body.data.counts.unseen).toBe(0);
    });
  });

  describe('database failure → 500', () => {
    it('getActiveVehicles throws → 500 without crashing', async () => {
      mockGetActiveVehicles.mockRejectedValue(new Error('db down'));
      const res = await request(app)
        .get('/inspections/dashboard')
        .set('Cookie', authCookie());
      expect(res.status).toBe(500);
      expect(res.body.statusCode).toBe('INTERNAL_ERROR');
    });

    it('getInspectionsByDate throws → 500', async () => {
      mockGetInspectionsByDate.mockRejectedValue(new Error('timeout'));
      const res = await request(app)
        .get('/inspections/dashboard')
        .set('Cookie', authCookie());
      expect(res.status).toBe(500);
    });
  });
});

// ═════════════════════════════════════════════════════════════════════════════
describe('POST /inspections', () => {
  describe('authentication', () => {
    it('no token → 401', async () => {
      const res = await request(app).post('/inspections').send(receivedBody);
      expect(res.status).toBe(401);
    });
  });

  describe('user configuration', () => {
    it('user without branchId → 400 NO_BRANCH', async () => {
      const res = await request(app)
        .post('/inspections')
        .set('Cookie', authCookie({ role: 'admin_global', branchId: undefined }))
        .send(receivedBody);
      expect(res.status).toBe(400);
      expect(res.body.statusCode).toBe('NO_BRANCH');
    });
  });

  describe('zod schema validation → 400', () => {
    it('empty body → 400 VALIDATION_ERROR with fieldErrors', async () => {
      const res = await request(app)
        .post('/inspections')
        .set('Cookie', authCookie())
        .send({});
      expect(res.status).toBe(400);
      expect(res.body.statusCode).toBe('VALIDATION_ERROR');
      expect(res.body.errors).toBeDefined();
    });

    it('missing vehicleId → 400 VALIDATION_ERROR', async () => {
      const { vehicleId: _, ...noId } = receivedBody;
      const res = await request(app)
        .post('/inspections')
        .set('Cookie', authCookie())
        .send(noId);
      expect(res.status).toBe(400);
      expect(res.body.statusCode).toBe('VALIDATION_ERROR');
    });

    it('invalid returnStatus value → 400 VALIDATION_ERROR', async () => {
      const res = await request(app)
        .post('/inspections')
        .set('Cookie', authCookie())
        .send({ ...receivedBody, returnStatus: 'flying' });
      expect(res.status).toBe(400);
      expect(res.body.errors).toHaveProperty('returnStatus');
    });

    it('invalid fuelLevel value → 400 VALIDATION_ERROR', async () => {
      const res = await request(app)
        .post('/inspections')
        .set('Cookie', authCookie())
        .send({ ...receivedBody, fuelLevel: 'overflowing' });
      expect(res.status).toBe(400);
      expect(res.body.errors).toHaveProperty('fuelLevel');
    });

    it('invalid cleanlinessStatus → 400 VALIDATION_ERROR', async () => {
      const res = await request(app)
        .post('/inspections')
        .set('Cookie', authCookie())
        .send({ ...receivedBody, cleanlinessStatus: 'spotless' });
      expect(res.status).toBe(400);
    });

    it('negative mileage → 400 VALIDATION_ERROR', async () => {
      const res = await request(app)
        .post('/inspections')
        .set('Cookie', authCookie())
        .send({ ...receivedBody, mileage: -100 });
      expect(res.status).toBe(400);
      expect(res.body.errors).toHaveProperty('mileage');
    });
  });

  describe('received-specific business validation → 400', () => {
    it('received without driver (no finalDriverId, no finalDriverNameManual) → 400 MISSING_DRIVER', async () => {
      const { finalDriverId: _, ...noDrv } = receivedBody;
      const res = await request(app)
        .post('/inspections')
        .set('Cookie', authCookie())
        .send(noDrv);
      expect(res.status).toBe(400);
      expect(res.body.statusCode).toBe('MISSING_DRIVER');
    });

    it('received with finalDriverNameManual only (no id) is valid → 200', async () => {
      const { finalDriverId: _, ...noDrvId } = receivedBody;
      const res = await request(app)
        .post('/inspections')
        .set('Cookie', authCookie())
        .send({ ...noDrvId, finalDriverNameManual: 'Juan Externo' });
      expect(res.status).toBe(200);
    });

    it('received without mileage → 400 MISSING_MILEAGE', async () => {
      const { mileage: _, ...noMil } = receivedBody;
      const res = await request(app)
        .post('/inspections')
        .set('Cookie', authCookie())
        .send(noMil);
      expect(res.status).toBe(400);
      expect(res.body.statusCode).toBe('MISSING_MILEAGE');
    });

    it('received without fuelLevel → 400 MISSING_FUEL', async () => {
      const { fuelLevel: _, ...noFuel } = receivedBody;
      const res = await request(app)
        .post('/inspections')
        .set('Cookie', authCookie())
        .send(noFuel);
      expect(res.status).toBe(400);
      expect(res.body.statusCode).toBe('MISSING_FUEL');
    });

    it('received + exteriorGeneralStatus=damaged + no observation → 400 MISSING_OBSERVATION', async () => {
      const res = await request(app)
        .post('/inspections')
        .set('Cookie', authCookie())
        .send({ ...receivedBody, exteriorGeneralStatus: 'damaged' });
      expect(res.status).toBe(400);
      expect(res.body.statusCode).toBe('MISSING_OBSERVATION');
    });

    it('received + interiorGeneralStatus=damaged + no observation → 400 MISSING_OBSERVATION', async () => {
      const res = await request(app)
        .post('/inspections')
        .set('Cookie', authCookie())
        .send({ ...receivedBody, interiorGeneralStatus: 'damaged' });
      expect(res.status).toBe(400);
      expect(res.body.statusCode).toBe('MISSING_OBSERVATION');
    });

    it('received + toolsGeneralStatus=missing + no observation → 400 MISSING_OBSERVATION', async () => {
      const res = await request(app)
        .post('/inspections')
        .set('Cookie', authCookie())
        .send({ ...receivedBody, toolsGeneralStatus: 'missing' });
      expect(res.status).toBe(400);
      expect(res.body.statusCode).toBe('MISSING_OBSERVATION');
    });

    it('received + toolsGeneralStatus=missing + whitespace observation → 400 MISSING_OBSERVATION', async () => {
      const res = await request(app)
        .post('/inspections')
        .set('Cookie', authCookie())
        .send({ ...receivedBody, toolsGeneralStatus: 'missing', generalObservation: '   ' });
      expect(res.status).toBe(400);
      expect(res.body.statusCode).toBe('MISSING_OBSERVATION');
    });

    it('not_returned and never_left skip driver/mileage/fuel validation → 200', async () => {
      for (const rs of ['not_returned', 'never_left'] as const) {
        const res = await request(app)
          .post('/inspections')
          .set('Cookie', authCookie())
          .send({ vehicleId: '10', plate: 'ABC-123', returnStatus: rs });
        expect(res.status).toBe(200);
      }
    });
  });

  describe('scope / authorization → 403', () => {
    it('vehicle belongs to a different branch → 403 VEHICLE_OTHER_BRANCH', async () => {
      mockGetVehicleById.mockResolvedValue(vehicleRow({ branchId: 99 }));
      const res = await request(app)
        .post('/inspections')
        .set('Cookie', authCookie({ branchId: 1 }))
        .send(receivedBody);
      expect(res.status).toBe(403);
      expect(res.body.statusCode).toBe('VEHICLE_OTHER_BRANCH');
    });
  });

  describe('mileage warning flow', () => {
    it('mileage lower than previous → 200 MILEAGE_WARNING (not persisted)', async () => {
      mockValidateMileage.mockResolvedValue({
        hasWarning:     true,
        warningType:    'lower_than_previous',
        warningMessage: 'El km ingresado es menor al anterior.',
        previousMileage: 50000,
        difference:      -1000,
      });
      const res = await request(app)
        .post('/inspections')
        .set('Cookie', authCookie())
        .send(receivedBody);
      expect(res.status).toBe(200);
      expect(res.body.statusCode).toBe('MILEAGE_WARNING');
      expect(res.body.uiState).toBe('mileage_warning');
      expect(res.body.data.warningType).toBe('lower_than_previous');
      // Inspection must NOT have been saved yet.
      expect(mockCreateInspection).not.toHaveBeenCalled();
    });

    it('unusually high mileage → 200 MILEAGE_WARNING (not persisted)', async () => {
      mockValidateMileage.mockResolvedValue({
        hasWarning:     true,
        warningType:    'unusually_high',
        warningMessage: 'Diferencia inusualmente alta.',
        previousMileage: 50000,
        difference:      600,
      });
      const res = await request(app)
        .post('/inspections')
        .set('Cookie', authCookie())
        .send(receivedBody);
      expect(res.status).toBe(200);
      expect(res.body.statusCode).toBe('MILEAGE_WARNING');
      expect(mockCreateInspection).not.toHaveBeenCalled();
    });

    it('mileage warning + mileageWarningConfirmed=true → inspection saved with warning type', async () => {
      mockValidateMileage.mockResolvedValue({
        hasWarning:     true,
        warningType:    'lower_than_previous',
        warningMessage: 'Km menor al anterior.',
        previousMileage: 50000,
        difference:      -1000,
      });
      const res = await request(app)
        .post('/inspections')
        .set('Cookie', authCookie())
        .send({ ...receivedBody, mileage: 49000, mileageWarningConfirmed: true });
      expect(res.status).toBe(200);
      expect(res.body.statusCode).toBe('INSPECTION_SAVED');
      expect(mockCreateInspection).toHaveBeenCalledWith(
        expect.objectContaining({ mileageWarningType: 'lower_than_previous' }),
      );
    });
  });

  describe('inspection status derivation', () => {
    it('clean vehicle → status reviewed_ok', async () => {
      const res = await request(app)
        .post('/inspections')
        .set('Cookie', authCookie())
        .send(receivedBody);
      expect(res.status).toBe(200);
      expect(res.body.data.status).toBe('reviewed_ok');
    });

    it('exteriorGeneralStatus=observed → status reviewed_observation, no issue created', async () => {
      const res = await request(app)
        .post('/inspections')
        .set('Cookie', authCookie())
        .send({ ...receivedBody, exteriorGeneralStatus: 'observed' });
      expect(res.status).toBe(200);
      expect(res.body.data.status).toBe('reviewed_observation');
      expect(mockCreateIssue).not.toHaveBeenCalled();
    });

    it('cleanlinessStatus=very_dirty → status reviewed_observation', async () => {
      const res = await request(app)
        .post('/inspections')
        .set('Cookie', authCookie())
        .send({ ...receivedBody, cleanlinessStatus: 'very_dirty' });
      expect(res.status).toBe(200);
      expect(res.body.data.status).toBe('reviewed_observation');
    });

    it('exteriorGeneralStatus=damaged + observation → 200 INSPECTION_SAVED_WITH_ISSUE, status serious_issue', async () => {
      const res = await request(app)
        .post('/inspections')
        .set('Cookie', authCookie())
        .send({ ...receivedBody, exteriorGeneralStatus: 'damaged', generalObservation: 'Golpe en puerta' });
      expect(res.status).toBe(200);
      expect(res.body.statusCode).toBe('INSPECTION_SAVED_WITH_ISSUE');
      expect(res.body.data.status).toBe('serious_issue');
      expect(res.body.data.issueId).toBe('200');
      expect(mockCreateIssue).toHaveBeenCalledWith(
        expect.objectContaining({ issueType: 'damage', description: 'Golpe en puerta' }),
      );
      expect(mockSetOpenIssuesFlag).toHaveBeenCalledWith('10', true);
    });

    it('toolsGeneralStatus=missing + observation → issue created with issueType missing_tool', async () => {
      const res = await request(app)
        .post('/inspections')
        .set('Cookie', authCookie())
        .send({ ...receivedBody, toolsGeneralStatus: 'missing', generalObservation: 'Falta gato hidráulico' });
      expect(res.status).toBe(200);
      expect(res.body.statusCode).toBe('INSPECTION_SAVED_WITH_ISSUE');
      expect(mockCreateIssue).toHaveBeenCalledWith(
        expect.objectContaining({ issueType: 'missing_tool' }),
      );
    });

    it('returnStatus=not_returned → status not_returned', async () => {
      const res = await request(app)
        .post('/inspections')
        .set('Cookie', authCookie())
        .send({ vehicleId: '10', plate: 'ABC-123', returnStatus: 'not_returned' });
      expect(res.status).toBe(200);
      expect(res.body.data.status).toBe('not_returned');
    });

    it('returnStatus=other → status other', async () => {
      const res = await request(app)
        .post('/inspections')
        .set('Cookie', authCookie())
        .send({ vehicleId: '10', plate: 'ABC-123', returnStatus: 'other' });
      expect(res.status).toBe(200);
      expect(res.body.data.status).toBe('other');
    });
  });

  describe('create vs. update (idempotency)', () => {
    it('no existing inspection in this shift → createInspection called', async () => {
      mockGetInspectionForShift.mockResolvedValue(null);
      await request(app)
        .post('/inspections')
        .set('Cookie', authCookie())
        .send(receivedBody);
      expect(mockCreateInspection).toHaveBeenCalledTimes(1);
      expect(mockUpdateInspection).not.toHaveBeenCalled();
    });

    it('existing inspection in same shift → updateInspection called, not create', async () => {
      mockGetInspectionForShift.mockResolvedValue(inspectionRow());
      const res = await request(app)
        .post('/inspections')
        .set('Cookie', authCookie())
        .send(receivedBody);
      expect(res.status).toBe(200);
      expect(mockUpdateInspection).toHaveBeenCalledTimes(1);
      expect(mockCreateInspection).not.toHaveBeenCalled();
      expect(res.body.data.inspectionId).toBe('100');
    });

    it('updating existing that already had an issue does NOT create a second issue', async () => {
      mockGetInspectionForShift.mockResolvedValue(inspectionRow({ hasNewIssue: true }));
      await request(app)
        .post('/inspections')
        .set('Cookie', authCookie())
        .send({ ...receivedBody, exteriorGeneralStatus: 'damaged', generalObservation: 'ya registrado' });
      // hasNewIssue was already true → isFirstIssueDetection = false → no createIssue
      expect(mockCreateIssue).not.toHaveBeenCalled();
    });
  });

  describe('vehicle status side-effects', () => {
    it('vehicle received while in workshop status → setVehicleStatus called to active', async () => {
      mockGetVehicleById.mockResolvedValue(vehicleRow({ currentStatus: 'workshop' }));
      await request(app)
        .post('/inspections')
        .set('Cookie', authCookie())
        .send(receivedBody);
      expect(mockSetVehicleStatus).toHaveBeenCalledWith(
        expect.objectContaining({ vehicleId: '10', newStatus: 'active' }),
      );
    });

    it('vehicle already active → setVehicleStatus NOT called', async () => {
      mockGetVehicleById.mockResolvedValue(vehicleRow({ currentStatus: 'active' }));
      await request(app)
        .post('/inspections')
        .set('Cookie', authCookie())
        .send(receivedBody);
      expect(mockSetVehicleStatus).not.toHaveBeenCalled();
    });

    it('mileage provided on received → refreshVehicleMileage called', async () => {
      await request(app)
        .post('/inspections')
        .set('Cookie', authCookie())
        .send(receivedBody);
      expect(mockRefreshMileage).toHaveBeenCalledWith('10');
    });

    it('not_returned → refreshVehicleMileage NOT called (no physical mileage)', async () => {
      await request(app)
        .post('/inspections')
        .set('Cookie', authCookie())
        .send({ vehicleId: '10', plate: 'ABC-123', returnStatus: 'not_returned' });
      expect(mockRefreshMileage).not.toHaveBeenCalled();
    });
  });

  describe('database failure → 500', () => {
    it('getVehicleById throws → 500', async () => {
      mockGetVehicleById.mockRejectedValue(new Error('ECONNRESET'));
      const res = await request(app)
        .post('/inspections')
        .set('Cookie', authCookie())
        .send(receivedBody);
      expect(res.status).toBe(500);
      expect(res.body.statusCode).toBe('INTERNAL_ERROR');
    });

    it('createInspection throws → 500', async () => {
      mockCreateInspection.mockRejectedValue(new Error('db full'));
      const res = await request(app)
        .post('/inspections')
        .set('Cookie', authCookie())
        .send(receivedBody);
      expect(res.status).toBe(500);
    });

    it('createIssue throws after inspection saved → 500', async () => {
      mockCreateIssue.mockRejectedValue(new Error('constraint violation'));
      const res = await request(app)
        .post('/inspections')
        .set('Cookie', authCookie())
        .send({ ...receivedBody, exteriorGeneralStatus: 'damaged', generalObservation: 'Golpe' });
      expect(res.status).toBe(500);
    });

    it('DB outage does not crash the server process', async () => {
      mockGetVehicleById.mockRejectedValue(new Error('boom'));
      await request(app).post('/inspections').set('Cookie', authCookie()).send(receivedBody);
      const health = await request(app).get('/health');
      expect(health.status).toBe(200);
    });
  });
});

// ═════════════════════════════════════════════════════════════════════════════
describe('PATCH /inspections/:id', () => {
  describe('authentication', () => {
    it('no token → 401', async () => {
      const res = await request(app).patch('/inspections/100').send(receivedBody);
      expect(res.status).toBe(401);
    });
  });

  describe('authorization — role gating', () => {
    it('guardia role → 403 FORBIDDEN', async () => {
      const res = await request(app)
        .patch('/inspections/100')
        .set('Cookie', authCookie({ role: 'guardia' }))
        .send(receivedBody);
      expect(res.status).toBe(403);
      expect(res.body.statusCode).toBe('FORBIDDEN');
    });

    it.each(['jefe_operaciones', 'admin', 'admin_pais', 'admin_global'] as const)(
      '%s role (supervisor) can proceed past the role check',
      async (role) => {
        const res = await request(app)
          .patch('/inspections/100')
          .set('Cookie', authCookie({ role, branchId: 1, countryId: 1 }))
          .send(receivedBody);
        // Any result other than 403 means the role check was passed.
        expect(res.status).not.toBe(403);
      },
    );
  });

  describe('zod validation', () => {
    it('empty body → 400 VALIDATION_ERROR', async () => {
      const res = await request(app)
        .patch('/inspections/100')
        .set('Cookie', supervisorCookie())
        .send({});
      expect(res.status).toBe(400);
      expect(res.body.statusCode).toBe('VALIDATION_ERROR');
    });
  });

  describe('not found', () => {
    it('inspection does not exist (getInspectionById returns null) → 404', async () => {
      mockGetInspectionById.mockResolvedValue(null);
      const res = await request(app)
        .patch('/inspections/999')
        .set('Cookie', supervisorCookie())
        .send(receivedBody);
      expect(res.status).toBe(404);
      expect(res.body.statusCode).toBe('NOT_FOUND');
    });
  });

  describe('current-shift inspection (not sealed)', () => {
    it('valid edit of current shift → 200 INSPECTION_SAVED, no audit log', async () => {
      // inspectionRow defaults: localDate='2026-06-09', shift='morning' (same as shiftContext mock)
      mockGetInspectionById.mockResolvedValue(inspectionRow());
      const res = await request(app)
        .patch('/inspections/100')
        .set('Cookie', supervisorCookie())
        .send(receivedBody);
      expect(res.status).toBe(200);
      expect(res.body.statusCode).toBe('INSPECTION_SAVED');
      expect(mockCreateAuditLog).not.toHaveBeenCalled();
    });
  });

  describe('sealed inspection (past shift)', () => {
    const sealedInspection = () =>
      inspectionRow({ localDate: '2026-06-08', shift: 'morning' }); // different date from mock

    it('sealed inspection without modificationReason → 400 MODIFICATION_REASON_REQUIRED', async () => {
      mockGetInspectionById.mockResolvedValue(sealedInspection());
      const res = await request(app)
        .patch('/inspections/100')
        .set('Cookie', supervisorCookie())
        .send(receivedBody); // no modificationReason
      expect(res.status).toBe(400);
      expect(res.body.statusCode).toBe('MODIFICATION_REASON_REQUIRED');
    });

    it('sealed inspection with whitespace-only reason → 400 MODIFICATION_REASON_REQUIRED', async () => {
      mockGetInspectionById.mockResolvedValue(sealedInspection());
      const res = await request(app)
        .patch('/inspections/100')
        .set('Cookie', supervisorCookie())
        .send({ ...receivedBody, modificationReason: '   ' });
      expect(res.status).toBe(400);
      expect(res.body.statusCode).toBe('MODIFICATION_REASON_REQUIRED');
    });

    it('sealed inspection with valid reason → 200 INSPECTION_SAVED + audit log created', async () => {
      mockGetInspectionById.mockResolvedValue(sealedInspection());
      const res = await request(app)
        .patch('/inspections/100')
        .set('Cookie', supervisorCookie())
        .send({ ...receivedBody, modificationReason: 'Corrección de turno noche anterior' });
      expect(res.status).toBe(200);
      expect(res.body.statusCode).toBe('INSPECTION_SAVED');
      expect(mockCreateAuditLog).toHaveBeenCalledWith(
        expect.objectContaining({
          action:   'UPDATE_AFTER_SEAL',
          entity:   'Inspection',
          entityId: '100',
          reason:   'Corrección de turno noche anterior',
        }),
      );
      expect(mockUpdateInspection).toHaveBeenCalledWith(
        '100',
        expect.objectContaining({ modifiedAfterSeal: true }),
      );
    });

    it('sealed edit that introduces a new issue → INSPECTION_SAVED_WITH_ISSUE + audit log', async () => {
      mockGetInspectionById.mockResolvedValue(sealedInspection()); // hasNewIssue = false by default
      const res = await request(app)
        .patch('/inspections/100')
        .set('Cookie', supervisorCookie())
        .send({
          ...receivedBody,
          exteriorGeneralStatus: 'damaged',
          generalObservation: 'Raya en cofre',
          modificationReason: 'Se detectó al revisar fotos',
        });
      expect(res.status).toBe(200);
      expect(res.body.statusCode).toBe('INSPECTION_SAVED_WITH_ISSUE');
      expect(mockCreateIssue).toHaveBeenCalledTimes(1);
      expect(mockCreateAuditLog).toHaveBeenCalledTimes(1);
    });

    it('received + mileage on sealed edit → refreshVehicleMileage called', async () => {
      mockGetInspectionById.mockResolvedValue(sealedInspection());
      await request(app)
        .patch('/inspections/100')
        .set('Cookie', supervisorCookie())
        .send({ ...receivedBody, modificationReason: 'Corrección' });
      expect(mockRefreshMileage).toHaveBeenCalledWith('10');
    });
  });

  describe('mileage warning in edit flow', () => {
    it('edit with lower mileage and no confirmation → 200 MILEAGE_WARNING, inspection not updated', async () => {
      mockValidateMileage.mockResolvedValue({
        hasWarning: true, warningType: 'lower_than_previous',
        warningMessage: 'Km menor.', previousMileage: 50000, difference: -1000,
      });
      const res = await request(app)
        .patch('/inspections/100')
        .set('Cookie', supervisorCookie())
        .send(receivedBody);
      expect(res.status).toBe(200);
      expect(res.body.statusCode).toBe('MILEAGE_WARNING');
      expect(mockUpdateInspection).not.toHaveBeenCalled();
    });
  });

  describe('database failure → 500', () => {
    it('getInspectionById throws → 500', async () => {
      mockGetInspectionById.mockRejectedValue(new Error('db unreachable'));
      const res = await request(app)
        .patch('/inspections/100')
        .set('Cookie', supervisorCookie())
        .send(receivedBody);
      expect(res.status).toBe(500);
    });

    it('updateInspection throws → 500', async () => {
      mockUpdateInspection.mockRejectedValue(new Error('deadlock'));
      const res = await request(app)
        .patch('/inspections/100')
        .set('Cookie', supervisorCookie())
        .send(receivedBody);
      expect(res.status).toBe(500);
    });

    it('createAuditLog throws on sealed edit → 500', async () => {
      mockGetInspectionById.mockResolvedValue(
        inspectionRow({ localDate: '2026-06-08', shift: 'morning' }),
      );
      mockCreateAuditLog.mockRejectedValue(new Error('audit db full'));
      const res = await request(app)
        .patch('/inspections/100')
        .set('Cookie', supervisorCookie())
        .send({ ...receivedBody, modificationReason: 'test' });
      expect(res.status).toBe(500);
    });
  });
});

// ═════════════════════════════════════════════════════════════════════════════
describe('GET /inspections/:id', () => {
  it('no token → 401', async () => {
    const res = await request(app).get('/inspections/100');
    expect(res.status).toBe(401);
  });

  it('inspection not found → 404', async () => {
    mockGetInspectionById.mockResolvedValue(null);
    const res = await request(app)
      .get('/inspections/999')
      .set('Cookie', authCookie());
    expect(res.status).toBe(404);
    expect(res.body.statusCode).toBe('NOT_FOUND');
  });

  it('inspection found → 200 with data', async () => {
    const res = await request(app)
      .get('/inspections/100')
      .set('Cookie', authCookie());
    expect(res.status).toBe(200);
    expect(res.body.data).toMatchObject({ id: '100', vehicleId: '10', plate: 'ABC-123' });
  });

  it('DB failure → 500', async () => {
    mockGetInspectionById.mockRejectedValue(new Error('timeout'));
    const res = await request(app)
      .get('/inspections/100')
      .set('Cookie', authCookie());
    expect(res.status).toBe(500);
  });
});
