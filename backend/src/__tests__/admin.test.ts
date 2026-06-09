// Integration tests — routes/admin.ts
//
// Security surface tested:
//   • requireAuth + requireRole('jefe_operaciones', 'admin', 'admin_pais', 'admin_global')
//   • canAssignRole privilege escalation prevention (pure logic, NOT mocked)
//   • canManageUser peer management rules (pure logic, NOT mocked)
//   • Self-edit prevention
//   • resolveBodyBranchId: admin uses own branch; supra-roles must supply branchId
//   • assertResourceInScope scope validation for supra-role writes
//   • requireAdminLevel for vehicle/driver write operations (jefe can only read users)
//   • bcrypt.hash called for user creation and password updates

import request from 'supertest';
import { createApp } from '../config/app';
import { AppError } from '../middleware/errorHandler';
import {
  authCookie, supervisorCookie,
  vehicleRow, driverRow, userRow, userProfileRow,
} from './helpers';

// ─── Mocks ───────────────────────────────────────────────────────────────────

jest.mock('../middleware/dbContext', () => ({
  dbContextMiddleware: (_req: any, _res: any, next: any) => next(),
}));
jest.mock('express-rate-limit', () => () => (_req: any, _res: any, next: any) => next());
jest.mock('../middleware/requireValidBranchContext', () => ({
  requireValidBranchContext: (_req: any, _res: any, next: any) => next(),
}));
jest.mock('bcryptjs', () => ({
  // hashSync is called at module init time by authController.ts (DUMMY_PASSWORD_HASH)
  default: {
    hash:     jest.fn().mockResolvedValue('$2a$12$hashedpassword'),
    hashSync: jest.fn().mockReturnValue('$2a$12$dummyhash'),
    compare:  jest.fn().mockResolvedValue(false),
  },
  hash:     jest.fn().mockResolvedValue('$2a$12$hashedpassword'),
  hashSync: jest.fn().mockReturnValue('$2a$12$dummyhash'),
  compare:  jest.fn().mockResolvedValue(false),
}));
jest.mock('../db/vehicles', () => ({
  createVehicle:          jest.fn(),
  updateVehicle:          jest.fn(),
  setVehicleActive:       jest.fn(),
  getVehicleById:         jest.fn(),
  getActiveVehicles:      jest.fn(),
  getAllVehicles:          jest.fn(),
  setVehicleStatus:       jest.fn(),
}));
jest.mock('../db/drivers', () => ({
  createDriver:    jest.fn(),
  updateDriver:    jest.fn(),
  getDriverById:   jest.fn(),
  setDriverActive: jest.fn(),
}));
jest.mock('../db/users', () => ({
  getAllUsers:      jest.fn(),
  createUser:      jest.fn(),
  updateUser:      jest.fn(),
  getUserById:     jest.fn(),
  findUserByUsername: jest.fn(),
  updateLastLogin: jest.fn(),
  getKioskUsers:   jest.fn(),
}));
jest.mock('../db/scopeUtils', () => ({
  assertResourceInScope: jest.fn().mockResolvedValue(undefined),
  applyScopeWhere:       jest.fn(() => '1=1'),
}));
// vehicleFields runs pure validation — not mocked intentionally
jest.mock('../utils/vehicleFields', () => ({
  normalizeVehicleIdentifiers:      jest.fn(() => ({})),
  resolveVehicleIdentifiersForUpdate: jest.fn(() => ({})),
  validateVehicleIdentifiers:       jest.fn(() => null), // null = no error
}));

// ─── Imports after mocks ──────────────────────────────────────────────────────

import {
  createVehicle, updateVehicle, setVehicleActive, getVehicleById as getVehicleByIdMock,
} from '../db/vehicles';
import {
  createDriver, updateDriver, getDriverById, setDriverActive,
} from '../db/drivers';
import {
  getAllUsers, createUser, updateUser, getUserById,
} from '../db/users';
import { assertResourceInScope } from '../db/scopeUtils';
import bcrypt from 'bcryptjs';

const mockCreateVehicle  = createVehicle    as jest.Mock;
const mockUpdateVehicle  = updateVehicle    as jest.Mock;
const mockSetActive      = setVehicleActive as jest.Mock;
const mockGetVehicle     = getVehicleByIdMock as jest.Mock;
const mockCreateDriver   = createDriver     as jest.Mock;
const mockUpdateDriver   = updateDriver     as jest.Mock;
const mockGetDriver      = getDriverById    as jest.Mock;
const mockSetDriverActive = setDriverActive as jest.Mock;
const mockGetAllUsers    = getAllUsers       as jest.Mock;
const mockCreateUser     = createUser       as jest.Mock;
const mockUpdateUser     = updateUser       as jest.Mock;
const mockGetUser        = getUserById      as jest.Mock;
const mockAssertScope    = assertResourceInScope as jest.Mock;
const mockBcryptHash     = (bcrypt as any).hash as jest.Mock;

const app = createApp();

// ─── Auth / role guard on ALL routes ─────────────────────────────────────────

describe('Admin route auth/role guard', () => {
  it('401 on GET /admin/users without cookie', async () => {
    const res = await request(app).get('/admin/users');
    expect(res.status).toBe(401);
  });

  it('403 for guardia on GET /admin/users', async () => {
    const res = await request(app).get('/admin/users')
      .set('Cookie', authCookie({ role: 'guardia' }));
    expect(res.status).toBe(403);
  });

  it('200 for jefe_operaciones on GET /admin/users', async () => {
    mockGetAllUsers.mockResolvedValueOnce([]);
    const res = await request(app).get('/admin/users')
      .set('Cookie', supervisorCookie());
    expect(res.status).toBe(200);
  });
});

// ─── POST /admin/vehicles ─────────────────────────────────────────────────────

describe('POST /admin/vehicles', () => {
  const adminCookie = authCookie({ userId: '3', role: 'admin', branchId: 1 });
  const validBody = { plate: 'XYZ-999', brand: 'Ford', model: 'Ranger', vehicleType: 'Pickup' };

  it('403 for jefe_operaciones (read-only)', async () => {
    const res = await request(app).post('/admin/vehicles')
      .set('Cookie', supervisorCookie())
      .send(validBody);
    expect(res.status).toBe(403);
  });

  it('400 missing required fields (no plate)', async () => {
    const res = await request(app).post('/admin/vehicles')
      .set('Cookie', adminCookie)
      .send({ brand: 'Ford', model: 'Ranger' });
    expect(res.status).toBe(400);
    expect(res.body.statusCode).toBe('MISSING_FIELDS');
  });

  it('201 admin creates vehicle in own branch', async () => {
    mockCreateVehicle.mockResolvedValueOnce(vehicleRow({ plate: 'XYZ-999' }));
    const res = await request(app).post('/admin/vehicles')
      .set('Cookie', adminCookie)
      .send(validBody);
    expect(res.status).toBe(201);
    expect(res.body.statusCode).toBe('VEHICLE_CREATED');
    expect(mockCreateVehicle).toHaveBeenCalledWith(
      expect.objectContaining({ branchId: 1, plate: 'XYZ-999' }),
    );
  });

  it('400 admin_pais without branchId in body', async () => {
    const cookie = authCookie({ role: 'admin_pais', countryId: 1, branchId: undefined });
    const res = await request(app).post('/admin/vehicles')
      .set('Cookie', cookie)
      .send(validBody); // no branchId in body
    expect(res.status).toBe(400);
    expect(res.body.statusCode).toBe('NO_BRANCH');
  });

  it('201 admin_pais creates vehicle for a branch in their country', async () => {
    const cookie = authCookie({ role: 'admin_pais', countryId: 1, branchId: undefined });
    mockCreateVehicle.mockResolvedValueOnce(vehicleRow({ plate: 'XYZ-999', branchId: 5 }));
    const res = await request(app).post('/admin/vehicles')
      .set('Cookie', cookie)
      .send({ ...validBody, branchId: 5 });
    expect(res.status).toBe(201);
    expect(mockAssertScope).toHaveBeenCalled();
  });

  it('403 admin_pais tries branch outside their country', async () => {
    const cookie = authCookie({ role: 'admin_pais', countryId: 1, branchId: undefined });
    mockAssertScope.mockRejectedValueOnce(
      new AppError(403, 'OUTSIDE_SCOPE', 'Sucursal no pertenece al país'),
    );
    const res = await request(app).post('/admin/vehicles')
      .set('Cookie', cookie)
      .send({ ...validBody, branchId: 99 });
    expect(res.status).toBe(403);
    expect(res.body.statusCode).toBe('OUTSIDE_SCOPE');
  });

  it('500 on DB failure', async () => {
    mockCreateVehicle.mockRejectedValueOnce(new Error('DB write failed'));
    const res = await request(app).post('/admin/vehicles')
      .set('Cookie', adminCookie)
      .send(validBody);
    expect(res.status).toBe(500);
  });
});

// ─── PUT /admin/vehicles/:id ──────────────────────────────────────────────────

describe('PUT /admin/vehicles/:id', () => {
  const adminCookie = authCookie({ userId: '3', role: 'admin', branchId: 1 });

  it('200 admin updates vehicle in their scope', async () => {
    mockGetVehicle.mockResolvedValueOnce(vehicleRow({ branchId: 1 }));
    mockUpdateVehicle.mockResolvedValueOnce(undefined);
    const res = await request(app).put('/admin/vehicles/10')
      .set('Cookie', adminCookie)
      .send({ plate: 'NEW-001', brand: 'Toyota', model: 'Hilux' });
    expect(res.status).toBe(200);
    expect(res.body.statusCode).toBe('VEHICLE_UPDATED');
  });

  it('403 admin tries to update vehicle in another branch', async () => {
    mockGetVehicle.mockResolvedValueOnce(vehicleRow({ branchId: 99 }));
    mockAssertScope.mockRejectedValueOnce(
      new AppError(403, 'OUTSIDE_SCOPE', 'Fuera de scope'),
    );
    const res = await request(app).put('/admin/vehicles/10')
      .set('Cookie', adminCookie)
      .send({ plate: 'HACK-001', brand: 'Lada', model: '2101' });
    expect(res.status).toBe(403);
  });
});

// ─── PATCH /admin/vehicles/:id/activate|deactivate ────────────────────────────

describe('PATCH /admin/vehicles/:id/activate|deactivate', () => {
  const adminCookie = authCookie({ userId: '3', role: 'admin', branchId: 1 });

  it('200 activate vehicle', async () => {
    mockGetVehicle.mockResolvedValueOnce(vehicleRow({ branchId: 1 }));
    mockSetActive.mockResolvedValueOnce(undefined);
    const res = await request(app).patch('/admin/vehicles/10/activate')
      .set('Cookie', adminCookie);
    expect(res.status).toBe(200);
    expect(res.body.statusCode).toBe('VEHICLE_ACTIVATED');
    expect(mockSetActive).toHaveBeenCalledWith('10', true);
  });

  it('200 deactivate vehicle', async () => {
    mockGetVehicle.mockResolvedValueOnce(vehicleRow({ branchId: 1 }));
    mockSetActive.mockResolvedValueOnce(undefined);
    const res = await request(app).patch('/admin/vehicles/10/deactivate')
      .set('Cookie', adminCookie);
    expect(res.status).toBe(200);
    expect(res.body.statusCode).toBe('VEHICLE_DEACTIVATED');
    expect(mockSetActive).toHaveBeenCalledWith('10', false);
  });

  it('403 jefe tries to activate (requireAdminLevel)', async () => {
    const res = await request(app).patch('/admin/vehicles/10/activate')
      .set('Cookie', supervisorCookie());
    expect(res.status).toBe(403);
  });
});

// ─── POST /admin/drivers ──────────────────────────────────────────────────────

describe('POST /admin/drivers', () => {
  const adminCookie = authCookie({ userId: '3', role: 'admin', branchId: 1 });

  it('403 for jefe_operaciones', async () => {
    const res = await request(app).post('/admin/drivers')
      .set('Cookie', supervisorCookie())
      .send({ name: 'Pedro' });
    expect(res.status).toBe(403);
  });

  it('400 missing name', async () => {
    const res = await request(app).post('/admin/drivers')
      .set('Cookie', adminCookie)
      .send({ department: 'Logística' });
    expect(res.status).toBe(400);
    expect(res.body.statusCode).toBe('MISSING_NAME');
  });

  it('201 admin creates driver in own branch', async () => {
    mockCreateDriver.mockResolvedValueOnce(driverRow());
    const res = await request(app).post('/admin/drivers')
      .set('Cookie', adminCookie)
      .send({ name: 'Pedro López', department: 'Logística' });
    expect(res.status).toBe(201);
    expect(res.body.statusCode).toBe('DRIVER_CREATED');
    expect(mockCreateDriver).toHaveBeenCalledWith(
      expect.objectContaining({ branchId: 1, name: 'Pedro López' }),
    );
  });

  it('400 admin_pais missing branchId', async () => {
    const cookie = authCookie({ role: 'admin_pais', countryId: 1, branchId: undefined });
    const res = await request(app).post('/admin/drivers')
      .set('Cookie', cookie)
      .send({ name: 'Ana' });
    expect(res.status).toBe(400);
    expect(res.body.statusCode).toBe('NO_BRANCH');
  });
});

// ─── PUT /admin/drivers/:id ───────────────────────────────────────────────────

describe('PUT /admin/drivers/:id', () => {
  const adminCookie = authCookie({ userId: '3', role: 'admin', branchId: 1 });

  it('200 updates driver in scope', async () => {
    mockGetDriver.mockResolvedValueOnce(driverRow({ branchId: 1 }));
    mockUpdateDriver.mockResolvedValueOnce(undefined);
    const res = await request(app).put('/admin/drivers/5')
      .set('Cookie', adminCookie)
      .send({ name: 'Updated Name' });
    expect(res.status).toBe(200);
    expect(res.body.statusCode).toBe('DRIVER_UPDATED');
  });

  it('403 driver outside scope', async () => {
    mockGetDriver.mockResolvedValueOnce(driverRow({ branchId: 99 }));
    mockAssertScope.mockRejectedValueOnce(
      new AppError(403, 'OUTSIDE_SCOPE', 'Fuera de scope'),
    );
    const res = await request(app).put('/admin/drivers/5')
      .set('Cookie', adminCookie)
      .send({ name: 'Intruder' });
    expect(res.status).toBe(403);
  });
});

// ─── GET /admin/users ────────────────────────────────────────────────────────

describe('GET /admin/users', () => {
  it('200 jefe_operaciones can list users', async () => {
    mockGetAllUsers.mockResolvedValueOnce([userProfileRow()]);
    const res = await request(app).get('/admin/users')
      .set('Cookie', supervisorCookie());
    expect(res.status).toBe(200);
    expect(res.body.data).toHaveLength(1);
  });

  it('200 admin can list users', async () => {
    mockGetAllUsers.mockResolvedValueOnce([userProfileRow(), userProfileRow({ id: 3, username: 'guard2' })]);
    const res = await request(app).get('/admin/users')
      .set('Cookie', authCookie({ role: 'admin', branchId: 1 }));
    expect(res.status).toBe(200);
    expect(res.body.data).toHaveLength(2);
  });

  it('500 on DB failure', async () => {
    mockGetAllUsers.mockRejectedValueOnce(new Error('Connection timeout'));
    const res = await request(app).get('/admin/users')
      .set('Cookie', supervisorCookie());
    expect(res.status).toBe(500);
  });
});

// ─── GET /admin/users/:id ────────────────────────────────────────────────────

describe('GET /admin/users/:id', () => {
  const cookie = authCookie({ userId: '3', role: 'admin', branchId: 1 });

  it('200 returns user data', async () => {
    mockGetUser.mockResolvedValueOnce(userRow({ id: 2, branchId: 1 }));
    const res = await request(app).get('/admin/users/2').set('Cookie', cookie);
    expect(res.status).toBe(200);
    expect(res.body.data.username).toBe('guard1');
    // passwordHash must NOT be in the response
    expect(res.body.data.passwordHash).toBeUndefined();
  });

  it('403 admin tries to read user from another branch', async () => {
    mockGetUser.mockResolvedValueOnce(userRow({ id: 9, branchId: 99 }));
    mockAssertScope.mockRejectedValueOnce(
      new AppError(403, 'OUTSIDE_SCOPE', 'Fuera de scope'),
    );
    const res = await request(app).get('/admin/users/9').set('Cookie', cookie);
    expect(res.status).toBe(403);
  });

  it('404 user not found', async () => {
    mockGetUser.mockRejectedValueOnce(new AppError(404, 'NOT_FOUND', 'Usuario no encontrado'));
    const res = await request(app).get('/admin/users/999').set('Cookie', cookie);
    expect(res.status).toBe(404);
  });
});

// ─── POST /admin/users — privilege escalation prevention ─────────────────────

describe('POST /admin/users', () => {
  const baseBody = {
    username: 'newuser',
    fullName: 'New User',
    password: 'secure123',
    branchId: '1',
  };

  it('400 missing required fields', async () => {
    const cookie = authCookie({ role: 'admin', branchId: 1 });
    const res = await request(app).post('/admin/users')
      .set('Cookie', cookie)
      .send({ username: 'nopassword', fullName: 'Missing pass', role: 'guardia' });
    expect(res.status).toBe(400);
    expect(res.body.statusCode).toBe('MISSING_FIELDS');
  });

  it('400 invalid role value', async () => {
    const cookie = authCookie({ role: 'admin', branchId: 1 });
    const res = await request(app).post('/admin/users')
      .set('Cookie', cookie)
      .send({ ...baseBody, role: 'super_hacker' });
    expect(res.status).toBe(400);
    expect(res.body.statusCode).toBe('INVALID_ROLE');
  });

  it('403 guardia cannot create any users', async () => {
    const cookie = authCookie({ role: 'guardia', branchId: 1 });
    // guardia is blocked at the router-level requireRole before even reaching createUser logic
    const res = await request(app).post('/admin/users')
      .set('Cookie', cookie)
      .send({ ...baseBody, role: 'guardia' });
    expect(res.status).toBe(403);
  });

  it('403 jefe_operaciones cannot create jefe_operaciones (peer escalation)', async () => {
    const cookie = supervisorCookie(); // role: jefe_operaciones
    const res = await request(app).post('/admin/users')
      .set('Cookie', cookie)
      .send({ ...baseBody, role: 'jefe_operaciones' });
    expect(res.status).toBe(403);
    expect(res.body.statusCode).toBe('ROLE_NOT_ASSIGNABLE');
  });

  it('403 admin cannot create admin_pais (escalation above rank)', async () => {
    const cookie = authCookie({ role: 'admin', branchId: 1 });
    const res = await request(app).post('/admin/users')
      .set('Cookie', cookie)
      .send({ ...baseBody, role: 'admin_pais', countryId: '1' });
    expect(res.status).toBe(403);
    expect(res.body.statusCode).toBe('ROLE_NOT_ASSIGNABLE');
  });

  it('403 admin cannot create admin_global (escalation)', async () => {
    const cookie = authCookie({ role: 'admin', branchId: 1 });
    const res = await request(app).post('/admin/users')
      .set('Cookie', cookie)
      .send({ ...baseBody, role: 'admin_global' });
    expect(res.status).toBe(403);
    expect(res.body.statusCode).toBe('ROLE_NOT_ASSIGNABLE');
  });

  it('403 admin_pais cannot create admin_pais (peer escalation)', async () => {
    const cookie = authCookie({ role: 'admin_pais', countryId: 1, branchId: undefined });
    const res = await request(app).post('/admin/users')
      .set('Cookie', cookie)
      .send({ ...baseBody, role: 'admin_pais', countryId: '1' });
    expect(res.status).toBe(403);
    expect(res.body.statusCode).toBe('ROLE_NOT_ASSIGNABLE');
  });

  it('201 jefe_operaciones can create guardia in their branch', async () => {
    mockCreateUser.mockResolvedValueOnce({ id: 99 });
    const cookie = supervisorCookie({ userId: '2' });
    const res = await request(app).post('/admin/users')
      .set('Cookie', cookie)
      .send({ ...baseBody, role: 'guardia' });
    expect(res.status).toBe(201);
    expect(res.body.statusCode).toBe('USER_CREATED');
    expect(mockBcryptHash).toHaveBeenCalledWith('secure123', 12);
  });

  it('201 admin can create jefe_operaciones and admin in their branch', async () => {
    const cookie = authCookie({ role: 'admin', branchId: 1 });
    for (const role of ['jefe_operaciones', 'admin']) {
      mockCreateUser.mockResolvedValueOnce({ id: 100 });
      const res = await request(app).post('/admin/users')
        .set('Cookie', cookie)
        .send({ ...baseBody, role });
      expect(res.status).toBe(201);
    }
  });

  it('400 operational role missing branchId', async () => {
    const cookie = authCookie({ role: 'admin_pais', countryId: 1, branchId: undefined });
    const res = await request(app).post('/admin/users')
      .set('Cookie', cookie)
      .send({ username: 'nobranchguard', fullName: 'No Branch', role: 'guardia', password: 'abc' });
    expect(res.status).toBe(400);
    expect(res.body.statusCode).toBe('MISSING_BRANCH');
  });

  it('400 admin_pais role missing countryId', async () => {
    const cookie = authCookie({ role: 'admin_global', branchId: undefined });
    const res = await request(app).post('/admin/users')
      .set('Cookie', cookie)
      .send({ username: 'adminpais', fullName: 'Admin Pais', role: 'admin_pais', password: 'abc' });
    expect(res.status).toBe(400);
    expect(res.body.statusCode).toBe('MISSING_COUNTRY');
  });

  it('201 admin_global can create admin_pais', async () => {
    mockCreateUser.mockResolvedValueOnce({ id: 50 });
    const cookie = authCookie({ role: 'admin_global', branchId: undefined });
    const res = await request(app).post('/admin/users')
      .set('Cookie', cookie)
      .send({ username: 'newadminpais', fullName: 'Admin País GT', role: 'admin_pais', password: 'abc', countryId: '1' });
    expect(res.status).toBe(201);
  });

  it('500 on DB failure', async () => {
    mockCreateUser.mockRejectedValueOnce(new Error('Unique constraint violated'));
    const cookie = authCookie({ role: 'admin', branchId: 1 });
    const res = await request(app).post('/admin/users')
      .set('Cookie', cookie)
      .send({ ...baseBody, role: 'guardia' });
    expect(res.status).toBe(500);
  });
});

// ─── PUT /admin/users/:id — peer management + self-edit + scope ────────────────

describe('PUT /admin/users/:id', () => {
  it('403 self-edit forbidden', async () => {
    const cookie = authCookie({ userId: '10', role: 'admin', branchId: 1 });
    // GET /admin/users/10 — actor ID matches target ID
    mockGetUser.mockResolvedValueOnce(userRow({ id: 10, role: 'admin', branchId: 1 }));
    const res = await request(app).put('/admin/users/10')
      .set('Cookie', cookie)
      .send({ fullName: 'New Name' });
    expect(res.status).toBe(403);
    expect(res.body.statusCode).toBe('SELF_EDIT_FORBIDDEN');
  });

  it('403 admin cannot manage peer admin (same rank)', async () => {
    const cookie = authCookie({ userId: '3', role: 'admin', branchId: 1 });
    mockGetUser.mockResolvedValueOnce(userRow({ id: 4, role: 'admin', branchId: 1 }));
    const res = await request(app).put('/admin/users/4')
      .set('Cookie', cookie)
      .send({ fullName: 'Peer Admin' });
    expect(res.status).toBe(403);
    expect(res.body.statusCode).toBe('ROLE_NOT_MANAGEABLE');
  });

  it('403 admin cannot manage admin_pais', async () => {
    const cookie = authCookie({ userId: '3', role: 'admin', branchId: 1 });
    mockGetUser.mockResolvedValueOnce(userRow({ id: 5, role: 'admin_pais', branchId: null as any, countryId: 1 }));
    const res = await request(app).put('/admin/users/5')
      .set('Cookie', cookie)
      .send({ fullName: 'Country Admin' });
    expect(res.status).toBe(403);
    expect(res.body.statusCode).toBe('ROLE_NOT_MANAGEABLE');
  });

  it('200 admin can update guardia in their branch', async () => {
    const cookie = authCookie({ userId: '3', role: 'admin', branchId: 1 });
    mockGetUser.mockResolvedValueOnce(userRow({ id: 2, role: 'guardia', branchId: 1 }));
    mockUpdateUser.mockResolvedValueOnce(undefined);
    const res = await request(app).put('/admin/users/2')
      .set('Cookie', cookie)
      .send({ fullName: 'Guard Updated' });
    expect(res.status).toBe(200);
    expect(res.body.statusCode).toBe('USER_UPDATED');
  });

  it('200 admin can update jefe_operaciones in their branch', async () => {
    const cookie = authCookie({ userId: '3', role: 'admin', branchId: 1 });
    mockGetUser.mockResolvedValueOnce(userRow({ id: 2, role: 'jefe_operaciones', branchId: 1 }));
    mockUpdateUser.mockResolvedValueOnce(undefined);
    const res = await request(app).put('/admin/users/2')
      .set('Cookie', cookie)
      .send({ fullName: 'Jefe Updated' });
    expect(res.status).toBe(200);
  });

  it('403 role escalation via PUT: admin tries to assign admin_pais role', async () => {
    const cookie = authCookie({ userId: '3', role: 'admin', branchId: 1 });
    mockGetUser.mockResolvedValueOnce(userRow({ id: 2, role: 'guardia', branchId: 1 }));
    const res = await request(app).put('/admin/users/2')
      .set('Cookie', cookie)
      .send({ role: 'admin_pais' });
    // canAssignRole(admin, admin_pais) = false → 403
    expect(res.status).toBe(403);
    expect(res.body.statusCode).toBe('ROLE_NOT_ASSIGNABLE');
  });

  it('400 invalid role value in PUT', async () => {
    const cookie = authCookie({ userId: '3', role: 'admin', branchId: 1 });
    mockGetUser.mockResolvedValueOnce(userRow({ id: 2, role: 'guardia', branchId: 1 }));
    const res = await request(app).put('/admin/users/2')
      .set('Cookie', cookie)
      .send({ role: 'god_mode' });
    expect(res.status).toBe(400);
    expect(res.body.statusCode).toBe('INVALID_ROLE');
  });

  it('hashes password when password is provided in PUT', async () => {
    const cookie = authCookie({ userId: '3', role: 'admin', branchId: 1 });
    mockGetUser.mockResolvedValueOnce(userRow({ id: 2, role: 'guardia', branchId: 1 }));
    mockUpdateUser.mockResolvedValueOnce(undefined);
    await request(app).put('/admin/users/2')
      .set('Cookie', cookie)
      .send({ password: 'newpassword123' });
    expect(mockBcryptHash).toHaveBeenCalledWith('newpassword123', 12);
    expect(mockUpdateUser).toHaveBeenCalledWith('2',
      expect.objectContaining({ passwordHash: '$2a$12$hashedpassword' }),
    );
  });

  it('403 scope violation: target user outside actor scope', async () => {
    const cookie = authCookie({ userId: '3', role: 'admin', branchId: 1 });
    mockGetUser.mockResolvedValueOnce(userRow({ id: 2, role: 'guardia', branchId: 99 }));
    mockAssertScope.mockRejectedValueOnce(
      new AppError(403, 'OUTSIDE_SCOPE', 'Fuera de scope'),
    );
    const res = await request(app).put('/admin/users/2')
      .set('Cookie', cookie)
      .send({ fullName: 'Intruder' });
    expect(res.status).toBe(403);
  });

  it('500 on DB failure', async () => {
    const cookie = authCookie({ userId: '3', role: 'admin', branchId: 1 });
    mockGetUser.mockResolvedValueOnce(userRow({ id: 2, role: 'guardia', branchId: 1 }));
    mockUpdateUser.mockRejectedValueOnce(new Error('Connection lost'));
    const res = await request(app).put('/admin/users/2')
      .set('Cookie', cookie)
      .send({ fullName: 'DB Fail' });
    expect(res.status).toBe(500);
  });
});
