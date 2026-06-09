// Integration tests — routes/vehicleStatusTypes.ts + controllers/vehicleStatusTypeController.ts
//
// Security surface tested:
//   • requireAuth gate on all routes
//   • requireCountryAdmin guard (admin, jefe_op → 403; admin_pais, admin_global → 200)
//   • admin_pais scope containment: can only create/edit/delete types for their country
//   • isSystem protection: system types cannot be deleted
//   • Zod validation on POST and PUT
//   • Duplicate key (UQ constraint) → 409 DUPLICATE_KEY
//   • toSlug edge cases (special chars, unicode accents)
//   • 404 on unknown :id
//   • DB failures → 500

import request from 'supertest';
import { createApp } from '../config/app';
import { AppError } from '../middleware/errorHandler';
import { authCookie, supervisorCookie, vehicleStatusTypeRow } from './helpers';

// ─── Mocks ───────────────────────────────────────────────────────────────────

jest.mock('../middleware/dbContext', () => ({
  dbContextMiddleware: (_req: any, _res: any, next: any) => next(),
}));
jest.mock('express-rate-limit', () => () => (_req: any, _res: any, next: any) => next());

jest.mock('../db/vehicleStatusTypes', () => ({
  getVehicleStatusTypes:    jest.fn(),
  getAllVehicleStatusTypes:  jest.fn(),
  getVehicleStatusTypeById: jest.fn(),
  createVehicleStatusType:  jest.fn(),
  updateVehicleStatusType:  jest.fn(),
  toggleVehicleStatusType:  jest.fn(),
  deleteVehicleStatusType:  jest.fn(),
}));

// ─── Imports after mocks ──────────────────────────────────────────────────────

import {
  getVehicleStatusTypes, getAllVehicleStatusTypes, getVehicleStatusTypeById,
  createVehicleStatusType, updateVehicleStatusType, toggleVehicleStatusType,
  deleteVehicleStatusType,
} from '../db/vehicleStatusTypes';

const mockList        = getVehicleStatusTypes    as jest.Mock;
const mockListAll     = getAllVehicleStatusTypes  as jest.Mock;
const mockGetById     = getVehicleStatusTypeById as jest.Mock;
const mockCreate      = createVehicleStatusType  as jest.Mock;
const mockUpdate      = updateVehicleStatusType  as jest.Mock;
const mockToggle      = toggleVehicleStatusType  as jest.Mock;
const mockDelete      = deleteVehicleStatusType  as jest.Mock;

const app = createApp();

// ─── GET /vehicle-status-types ────────────────────────────────────────────────

describe('GET /vehicle-status-types', () => {
  it('401 unauthenticated', async () => {
    const res = await request(app).get('/vehicle-status-types');
    expect(res.status).toBe(401);
  });

  it('200 guardia can list active types', async () => {
    mockList.mockResolvedValueOnce([vehicleStatusTypeRow()]);
    const res = await request(app).get('/vehicle-status-types')
      .set('Cookie', authCookie({ role: 'guardia', branchId: 1 }));
    expect(res.status).toBe(200);
    expect(res.body.data).toHaveLength(1);
  });

  it('200 filters by user countryId', async () => {
    mockList.mockResolvedValueOnce([]);
    const cookie = authCookie({ role: 'admin_pais', countryId: 2 });
    await request(app).get('/vehicle-status-types').set('Cookie', cookie);
    // countryId=2 should be passed to the DB function
    expect(mockList).toHaveBeenCalledWith(2);
  });

  it('500 on DB failure', async () => {
    mockList.mockRejectedValueOnce(new Error('DB error'));
    const res = await request(app).get('/vehicle-status-types')
      .set('Cookie', authCookie());
    expect(res.status).toBe(500);
  });
});

// ─── GET /vehicle-status-types/all ───────────────────────────────────────────

describe('GET /vehicle-status-types/all', () => {
  it('403 guardia', async () => {
    const res = await request(app).get('/vehicle-status-types/all')
      .set('Cookie', authCookie({ role: 'guardia' }));
    expect(res.status).toBe(403);
    expect(res.body.statusCode).toBe('FORBIDDEN');
  });

  it('403 jefe_operaciones', async () => {
    const res = await request(app).get('/vehicle-status-types/all')
      .set('Cookie', supervisorCookie());
    expect(res.status).toBe(403);
  });

  it('403 admin (requires admin_pais+)', async () => {
    const res = await request(app).get('/vehicle-status-types/all')
      .set('Cookie', authCookie({ role: 'admin', branchId: 1 }));
    expect(res.status).toBe(403);
  });

  it('200 admin_pais sees global + their country types', async () => {
    mockListAll.mockResolvedValueOnce([vehicleStatusTypeRow({ isSystem: true, countryId: null as any })]);
    const cookie = authCookie({ role: 'admin_pais', countryId: 1 });
    const res = await request(app).get('/vehicle-status-types/all').set('Cookie', cookie);
    expect(res.status).toBe(200);
    // countryId=1 passed (not global)
    expect(mockListAll).toHaveBeenCalledWith(1);
  });

  it('200 admin_global sees all types (countryId=undefined)', async () => {
    mockListAll.mockResolvedValueOnce([vehicleStatusTypeRow(), vehicleStatusTypeRow({ id: 2, key: 'abroad', countryId: null as any })]);
    const cookie = authCookie({ role: 'admin_global', branchId: undefined });
    const res = await request(app).get('/vehicle-status-types/all').set('Cookie', cookie);
    expect(res.status).toBe(200);
    expect(mockListAll).toHaveBeenCalledWith(undefined);
  });
});

// ─── POST /vehicle-status-types ──────────────────────────────────────────────

describe('POST /vehicle-status-types', () => {
  const adminPaisCookie = authCookie({ role: 'admin_pais', countryId: 1 });
  const validBody = { labelEs: 'En mantenimiento', color: 'amber', sortOrder: 2 };

  it('403 for admin or below', async () => {
    for (const role of ['guardia', 'jefe_operaciones', 'admin'] as const) {
      const res = await request(app).post('/vehicle-status-types')
        .set('Cookie', authCookie({ role, branchId: 1 }))
        .send(validBody);
      expect(res.status).toBe(403);
    }
  });

  it('400 missing labelEs', async () => {
    const res = await request(app).post('/vehicle-status-types')
      .set('Cookie', adminPaisCookie)
      .send({ color: 'amber' });
    expect(res.status).toBe(400);
    expect(res.body.statusCode).toBe('VALIDATION_ERROR');
  });

  it('400 invalid color', async () => {
    const res = await request(app).post('/vehicle-status-types')
      .set('Cookie', adminPaisCookie)
      .send({ labelEs: 'Test', color: 'rainbow' });
    expect(res.status).toBe(400);
    expect(res.body.statusCode).toBe('VALIDATION_ERROR');
  });

  it('400 labelEs too short (min 2 chars)', async () => {
    const res = await request(app).post('/vehicle-status-types')
      .set('Cookie', adminPaisCookie)
      .send({ labelEs: 'X', color: 'blue' });
    expect(res.status).toBe(400);
  });

  it('201 admin_pais creates type for their country (countryId forced from token)', async () => {
    mockCreate.mockResolvedValueOnce(vehicleStatusTypeRow({ key: 'en_mantenimiento', labelEs: 'En mantenimiento' }));
    const res = await request(app).post('/vehicle-status-types')
      .set('Cookie', adminPaisCookie)
      .send(validBody);
    expect(res.status).toBe(201);
    expect(res.body.statusCode).toBe('CREATED');
    // admin_pais countryId override: createVehicleStatusType called with countryId=1
    expect(mockCreate).toHaveBeenCalledWith(
      expect.objectContaining({ key: 'en_mantenimiento', countryId: 1 }),
    );
  });

  it('admin_pais cannot override their own countryId in the body', async () => {
    mockCreate.mockResolvedValueOnce(vehicleStatusTypeRow());
    await request(app).post('/vehicle-status-types')
      .set('Cookie', adminPaisCookie)
      .send({ ...validBody, countryId: 999 }); // should be ignored
    // createVehicleStatusType should be called with countryId=1 (from token), not 999
    expect(mockCreate).toHaveBeenCalledWith(
      expect.objectContaining({ countryId: 1 }),
    );
  });

  it('409 duplicate key', async () => {
    mockCreate.mockRejectedValueOnce(
      Object.assign(new Error('UQ_VehicleStatusTypes_Key'), { message: 'UQ_VehicleStatusTypes_Key' }),
    );
    const res = await request(app).post('/vehicle-status-types')
      .set('Cookie', adminPaisCookie)
      .send(validBody);
    expect(res.status).toBe(409);
    expect(res.body.statusCode).toBe('DUPLICATE_KEY');
  });

  it('toSlug handles unicode accents correctly', async () => {
    mockCreate.mockResolvedValueOnce(vehicleStatusTypeRow({ key: 'en_reparacion' }));
    await request(app).post('/vehicle-status-types')
      .set('Cookie', adminPaisCookie)
      .send({ labelEs: 'En Reparación', color: 'red' });
    expect(mockCreate).toHaveBeenCalledWith(
      expect.objectContaining({ key: 'en_reparacion' }),
    );
  });

  it('400 label with only special chars produces no slug', async () => {
    const res = await request(app).post('/vehicle-status-types')
      .set('Cookie', adminPaisCookie)
      .send({ labelEs: '!!! ???', color: 'blue' });
    expect(res.status).toBe(400);
    expect(res.body.statusCode).toBe('INVALID_LABEL');
  });

  it('201 admin_global creates global type (no countryId)', async () => {
    mockCreate.mockResolvedValueOnce(vehicleStatusTypeRow({ countryId: null as any, key: 'global_status' }));
    const cookie = authCookie({ role: 'admin_global', branchId: undefined });
    const res = await request(app).post('/vehicle-status-types')
      .set('Cookie', cookie)
      .send({ labelEs: 'Global Status', color: 'slate' });
    expect(res.status).toBe(201);
  });

  it('500 on DB failure', async () => {
    mockCreate.mockRejectedValueOnce(new Error('Connection lost'));
    const res = await request(app).post('/vehicle-status-types')
      .set('Cookie', adminPaisCookie)
      .send(validBody);
    expect(res.status).toBe(500);
  });
});

// ─── PUT /vehicle-status-types/:id ───────────────────────────────────────────

describe('PUT /vehicle-status-types/:id', () => {
  const adminPaisCookie = authCookie({ role: 'admin_pais', countryId: 1 });

  it('400 non-numeric id', async () => {
    const res = await request(app).put('/vehicle-status-types/not-a-number')
      .set('Cookie', adminPaisCookie)
      .send({ labelEs: 'Test' });
    expect(res.status).toBe(400);
    expect(res.body.statusCode).toBe('INVALID_ID');
  });

  it('404 type not found', async () => {
    mockGetById.mockResolvedValueOnce(null);
    const res = await request(app).put('/vehicle-status-types/999')
      .set('Cookie', adminPaisCookie)
      .send({ labelEs: 'Test' });
    expect(res.status).toBe(404);
  });

  it('403 admin_pais tries to edit type from another country', async () => {
    mockGetById.mockResolvedValueOnce(vehicleStatusTypeRow({ countryId: 99 })); // different country
    const res = await request(app).put('/vehicle-status-types/1')
      .set('Cookie', adminPaisCookie)
      .send({ labelEs: 'Hacker' });
    expect(res.status).toBe(403);
    expect(res.body.statusCode).toBe('FORBIDDEN');
  });

  it('200 admin_pais updates type in their country', async () => {
    mockGetById.mockResolvedValueOnce(vehicleStatusTypeRow({ countryId: 1 }));
    mockUpdate.mockResolvedValueOnce(undefined);
    const res = await request(app).put('/vehicle-status-types/1')
      .set('Cookie', adminPaisCookie)
      .send({ labelEs: 'En taller actualizado', color: 'orange' });
    expect(res.status).toBe(200);
    expect(res.body.statusCode).toBe('UPDATED');
  });

  it('400 update with invalid color', async () => {
    mockGetById.mockResolvedValueOnce(vehicleStatusTypeRow({ countryId: 1 }));
    const res = await request(app).put('/vehicle-status-types/1')
      .set('Cookie', adminPaisCookie)
      .send({ color: 'neon_pink' });
    expect(res.status).toBe(400);
    expect(res.body.statusCode).toBe('VALIDATION_ERROR');
  });

  it('200 admin_global updates any type regardless of countryId', async () => {
    mockGetById.mockResolvedValueOnce(vehicleStatusTypeRow({ countryId: 99 }));
    mockUpdate.mockResolvedValueOnce(undefined);
    const cookie = authCookie({ role: 'admin_global', branchId: undefined });
    const res = await request(app).put('/vehicle-status-types/1')
      .set('Cookie', cookie)
      .send({ sortOrder: 5 });
    expect(res.status).toBe(200);
  });
});

// ─── PATCH /vehicle-status-types/:id/toggle ──────────────────────────────────

describe('PATCH /vehicle-status-types/:id/toggle', () => {
  const adminPaisCookie = authCookie({ role: 'admin_pais', countryId: 1 });

  it('200 toggles active type to inactive', async () => {
    mockGetById.mockResolvedValueOnce(vehicleStatusTypeRow({ active: true, countryId: 1 }));
    mockToggle.mockResolvedValueOnce(undefined);
    const res = await request(app).patch('/vehicle-status-types/1/toggle')
      .set('Cookie', adminPaisCookie);
    expect(res.status).toBe(200);
    expect(mockToggle).toHaveBeenCalledWith(1, false); // !active
  });

  it('200 toggles inactive type to active', async () => {
    mockGetById.mockResolvedValueOnce(vehicleStatusTypeRow({ active: false, countryId: 1 }));
    mockToggle.mockResolvedValueOnce(undefined);
    const res = await request(app).patch('/vehicle-status-types/1/toggle')
      .set('Cookie', adminPaisCookie);
    expect(res.status).toBe(200);
    expect(mockToggle).toHaveBeenCalledWith(1, true); // !active
  });

  it('403 admin_pais toggles type from another country', async () => {
    mockGetById.mockResolvedValueOnce(vehicleStatusTypeRow({ countryId: 99 }));
    const res = await request(app).patch('/vehicle-status-types/1/toggle')
      .set('Cookie', adminPaisCookie);
    expect(res.status).toBe(403);
  });

  it('404 type not found', async () => {
    mockGetById.mockResolvedValueOnce(null);
    const res = await request(app).patch('/vehicle-status-types/999/toggle')
      .set('Cookie', adminPaisCookie);
    expect(res.status).toBe(404);
  });
});

// ─── DELETE /vehicle-status-types/:id ────────────────────────────────────────

describe('DELETE /vehicle-status-types/:id', () => {
  const adminPaisCookie = authCookie({ role: 'admin_pais', countryId: 1 });

  it('403 for non-country-admin roles', async () => {
    for (const role of ['guardia', 'jefe_operaciones', 'admin'] as const) {
      const res = await request(app).delete('/vehicle-status-types/1')
        .set('Cookie', authCookie({ role, branchId: 1 }));
      expect(res.status).toBe(403);
    }
  });

  it('404 type not found', async () => {
    mockGetById.mockResolvedValueOnce(null);
    const res = await request(app).delete('/vehicle-status-types/999')
      .set('Cookie', adminPaisCookie);
    expect(res.status).toBe(404);
  });

  it('409 cannot delete system type', async () => {
    mockGetById.mockResolvedValueOnce(vehicleStatusTypeRow({ isSystem: true, countryId: 1 }));
    const res = await request(app).delete('/vehicle-status-types/1')
      .set('Cookie', adminPaisCookie);
    expect(res.status).toBe(409);
    expect(res.body.statusCode).toBe('SYSTEM_TYPE');
    expect(mockDelete).not.toHaveBeenCalled();
  });

  it('403 admin_pais tries to delete type from another country', async () => {
    mockGetById.mockResolvedValueOnce(vehicleStatusTypeRow({ isSystem: false, countryId: 99 }));
    const res = await request(app).delete('/vehicle-status-types/1')
      .set('Cookie', adminPaisCookie);
    expect(res.status).toBe(403);
  });

  it('200 admin_pais deletes their own non-system type', async () => {
    mockGetById.mockResolvedValueOnce(vehicleStatusTypeRow({ isSystem: false, countryId: 1 }));
    mockDelete.mockResolvedValueOnce(true);
    const res = await request(app).delete('/vehicle-status-types/1')
      .set('Cookie', adminPaisCookie);
    expect(res.status).toBe(200);
    expect(res.body.statusCode).toBe('DELETED');
  });

  it('409 when deleteVehicleStatusType returns false (e.g. race condition)', async () => {
    mockGetById.mockResolvedValueOnce(vehicleStatusTypeRow({ isSystem: false, countryId: 1 }));
    mockDelete.mockResolvedValueOnce(false);
    const res = await request(app).delete('/vehicle-status-types/1')
      .set('Cookie', adminPaisCookie);
    expect(res.status).toBe(409);
  });

  it('500 on DB failure', async () => {
    mockGetById.mockResolvedValueOnce(vehicleStatusTypeRow({ isSystem: false, countryId: 1 }));
    mockDelete.mockRejectedValueOnce(new Error('FK constraint'));
    const res = await request(app).delete('/vehicle-status-types/1')
      .set('Cookie', adminPaisCookie);
    expect(res.status).toBe(500);
  });
});
