import { Router } from 'express';
import bcrypt from 'bcryptjs';
import { requireAuth } from '../middleware/auth';
import { requireRole } from '../middleware/roles';
import { scopeFromRequest } from '../middleware/tenantScope';
import { requireValidBranchContext } from '../middleware/requireValidBranchContext';
import { assertResourceInScope } from '../db/scopeUtils';
import { canAssignRole, canManageUser, isValidRole } from '../utils/roleCapabilities';
import {
  createVehicle,
  updateVehicle,
  setVehicleActive,
  getVehicleById,
} from '../db/vehicles';
import {
  createDriver,
  updateDriver,
  getDriverById,
  setDriverActive,
} from '../db/drivers';
import {
  getAllUsers,
  createUser,
  updateUser,
  getUserById,
} from '../db/users';
import type { UserRole } from '../types';
import {
  normalizeVehicleIdentifiers,
  resolveVehicleIdentifiersForUpdate,
  validateVehicleIdentifiers,
  parseInitialMileage,
  MAX_INITIAL_MILEAGE,
} from '../utils/vehicleFields';

const router = Router();

// All admin routes require authentication and at minimum jefe_operaciones level.
router.use(requireAuth, requireRole('jefe_operaciones', 'admin', 'admin_pais', 'admin_global'));

// Write operations on vehicles and drivers require admin level or above.
// jefe_operaciones has read-only access to the catalog.
const requireAdminLevel = requireRole('admin', 'admin_pais', 'admin_global');

// ─── Helpers ──────────────────────────────────────────────────────────────────

/**
 * Resolves the branchId for a resource creation request.
 *
 * - admin / jefe_operaciones: always their own branch (from token).
 * - admin_pais / admin_global: must supply branchId in the request body,
 *   and the body value is validated against their scope before the caller
 *   proceeds to create the resource.
 *
 * Returns undefined if a supra-role didn't provide bodyBranchId (caller
 * should respond with 400 in that case).
 */
function resolveBodyBranchId(
  actorBranchId: number | undefined,
  role:          UserRole,
  bodyBranchId:  string | number | undefined,
): number | undefined {
  const supraRoles: UserRole[] = ['admin_global', 'admin_pais'];
  if (supraRoles.includes(role)) {
    return bodyBranchId ? parseInt(String(bodyBranchId), 10) : undefined;
  }
  return actorBranchId;
}

// ─── Vehicles ─────────────────────────────────────────────────────────────────

router.post('/vehicles', requireAdminLevel, async (req, res, next) => {
  try {
    const { plate, vehicleType, brand, model, year, notes, branchId: bodyBranchId } = req.body;
    const identifiers = normalizeVehicleIdentifiers(req.body);
    const idError = validateVehicleIdentifiers(identifiers);
    if (idError) {
      res.status(400).json({ success: false, statusCode: 'INVALID_IDENTIFIERS', message: idError, uiState: 'validation_error' });
      return;
    }

    if (!plate || !brand || !model) {
      res.status(400).json({ success: false, statusCode: 'MISSING_FIELDS', message: 'Placa, marca y modelo son obligatorios.', uiState: 'validation_error' });
      return;
    }

    // Kilometraje inicial: entero acotado [0, MAX]. parseInitialMileage devuelve
    // null para valores inválidos (negativos, fuera de rango, no enteros, basura
    // tipo '100abc' o tipos no numéricos) → 400 antes de tocar la DB.
    const initialMileage = parseInitialMileage(req.body.initialMileage);
    if (initialMileage === null) {
      res.status(400).json({ success: false, statusCode: 'INVALID_MILEAGE', message: `El kilometraje inicial debe ser un entero entre 0 y ${MAX_INITIAL_MILEAGE}.`, uiState: 'validation_error' });
      return;
    }

    const branchId = resolveBodyBranchId(req.user!.branchId, req.user!.role, bodyBranchId);
    if (!branchId) {
      res.status(400).json({ success: false, statusCode: 'NO_BRANCH', message: 'Se requiere especificar una sucursal.', uiState: 'validation_error' });
      return;
    }

    // For supra-roles: validate the specified branch is within their scope.
    // admin_global → scope is global → always passes.
    // admin_pais   → scope is country → validates branch belongs to their country.
    if (['admin_global', 'admin_pais'].includes(req.user!.role)) {
      await assertResourceInScope(branchId, scopeFromRequest(req));
    }

    const vehicle = await createVehicle({
      branchId,
      plate,
      vehicleType,
      brand,
      model,
      year: year ?? null,
      notes,
      initialMileage,
      ...identifiers,
    });
    res.status(201).json({ success: true, statusCode: 'VEHICLE_CREATED', message: 'Vehículo creado.', uiState: 'saved_successfully', data: vehicle });
  } catch (err) { next(err); }
});

router.put('/vehicles/:id', requireAdminLevel, async (req, res, next) => {
  try {
    const vehicle = await getVehicleById(req.params.id);
    if (!vehicle) {
      res.status(404).json({ success: false, statusCode: 'NOT_FOUND', message: 'Vehículo no encontrado.', uiState: 'not_found' });
      return;
    }
    await assertResourceInScope(vehicle.branchId, scopeFromRequest(req));
    const { plate, vehicleType, brand, model, year, notes } = req.body;
    const identifiers = resolveVehicleIdentifiersForUpdate(req.body);
    const idError = validateVehicleIdentifiers({
      chassisNumber: identifiers.chassisNumber ?? undefined,
      vin:           identifiers.vin ?? undefined,
      engineNumber:  identifiers.engineNumber ?? undefined,
    });
    if (idError) {
      res.status(400).json({ success: false, statusCode: 'INVALID_IDENTIFIERS', message: idError, uiState: 'validation_error' });
      return;
    }
    await updateVehicle(req.params.id, {
      plate,
      vehicleType,
      brand,
      model,
      year,
      notes,
      ...(identifiers.chassisNumber !== undefined && { chassisNumber: identifiers.chassisNumber }),
      ...(identifiers.vin !== undefined && { vin: identifiers.vin }),
      ...(identifiers.engineNumber !== undefined && { engineNumber: identifiers.engineNumber }),
    });
    res.json({ success: true, statusCode: 'VEHICLE_UPDATED', message: 'Vehículo actualizado.', uiState: 'saved_successfully' });
  } catch (err) { next(err); }
});

router.patch('/vehicles/:id/activate', requireAdminLevel, async (req, res, next) => {
  try {
    const vehicle = await getVehicleById(req.params.id);
    if (!vehicle) {
      res.status(404).json({ success: false, statusCode: 'NOT_FOUND', message: 'Vehículo no encontrado.', uiState: 'not_found' });
      return;
    }
    await assertResourceInScope(vehicle.branchId, scopeFromRequest(req));
    await setVehicleActive(req.params.id, true);
    res.json({ success: true, statusCode: 'VEHICLE_ACTIVATED', message: 'Vehículo activado.', uiState: 'saved_successfully' });
  } catch (err) { next(err); }
});

router.patch('/vehicles/:id/deactivate', requireAdminLevel, async (req, res, next) => {
  try {
    const vehicle = await getVehicleById(req.params.id);
    if (!vehicle) {
      res.status(404).json({ success: false, statusCode: 'NOT_FOUND', message: 'Vehículo no encontrado.', uiState: 'not_found' });
      return;
    }
    await assertResourceInScope(vehicle.branchId, scopeFromRequest(req));
    await setVehicleActive(req.params.id, false);
    res.json({ success: true, statusCode: 'VEHICLE_DEACTIVATED', message: 'Vehículo desactivado.', uiState: 'saved_successfully' });
  } catch (err) { next(err); }
});

// ─── Drivers ──────────────────────────────────────────────────────────────────

router.post('/drivers', requireAdminLevel, async (req, res, next) => {
  try {
    const { name, department, branchId: bodyBranchId } = req.body;

    if (!name) {
      res.status(400).json({ success: false, statusCode: 'MISSING_NAME', message: 'El nombre es obligatorio.', uiState: 'validation_error' });
      return;
    }

    const branchId = resolveBodyBranchId(req.user!.branchId, req.user!.role, bodyBranchId);
    if (!branchId) {
      res.status(400).json({ success: false, statusCode: 'NO_BRANCH', message: 'Se requiere especificar una sucursal.', uiState: 'validation_error' });
      return;
    }

    if (['admin_global', 'admin_pais'].includes(req.user!.role)) {
      await assertResourceInScope(branchId, scopeFromRequest(req));
    }

    const driver = await createDriver({ name, department, branchId });
    res.status(201).json({ success: true, statusCode: 'DRIVER_CREATED', message: 'Conductor creado.', uiState: 'saved_successfully', data: driver });
  } catch (err) { next(err); }
});

router.put('/drivers/:id', requireAdminLevel, async (req, res, next) => {
  try {
    const driver = await getDriverById(req.params.id);
    await assertResourceInScope(driver.branchId, scopeFromRequest(req));
    const { name, department, active } = req.body;
    await updateDriver(req.params.id, { name, department, active });
    res.json({ success: true, statusCode: 'DRIVER_UPDATED', message: 'Conductor actualizado.', uiState: 'saved_successfully' });
  } catch (err) { next(err); }
});

router.patch('/drivers/:id/activate', requireAdminLevel, async (req, res, next) => {
  try {
    const driver = await getDriverById(req.params.id);
    await assertResourceInScope(driver.branchId, scopeFromRequest(req));
    await setDriverActive(req.params.id, true);
    res.json({ success: true, statusCode: 'DRIVER_ACTIVATED', message: 'Conductor activado.', uiState: 'saved_successfully' });
  } catch (err) { next(err); }
});

router.patch('/drivers/:id/deactivate', requireAdminLevel, async (req, res, next) => {
  try {
    const driver = await getDriverById(req.params.id);
    await assertResourceInScope(driver.branchId, scopeFromRequest(req));
    await setDriverActive(req.params.id, false);
    res.json({ success: true, statusCode: 'DRIVER_DEACTIVATED', message: 'Conductor desactivado.', uiState: 'saved_successfully' });
  } catch (err) { next(err); }
});

// ─── Users ────────────────────────────────────────────────────────────────────

router.get('/users', requireValidBranchContext, async (req, res, next) => {
  try {
    const users = await getAllUsers(scopeFromRequest(req));
    res.json({ success: true, statusCode: 'OK', message: 'Usuarios.', uiState: 'saved_successfully', data: users });
  } catch (err) { next(err); }
});

router.get('/users/:id', async (req, res, next) => {
  try {
    const target = await getUserById(req.params.id);
    await assertResourceInScope(target.branchId ?? null, scopeFromRequest(req));
    res.json({
      success: true,
      statusCode: 'OK',
      message: 'Usuario.',
      uiState: 'saved_successfully',
      data: {
        id: String(target.id),
        username: target.username,
        fullName: target.fullName,
        role: target.role,
        active: target.active,
        branchId: target.branchId,
        countryId: target.countryId,
      },
    });
  } catch (err) { next(err); }
});

router.post('/users', async (req, res, next) => {
  try {
    const { username, fullName, role, password, branchId, countryId } = req.body;
    const actor = req.user!;

    if (!username || !fullName || !role || !password) {
      res.status(400).json({ success: false, statusCode: 'MISSING_FIELDS', message: 'Todos los campos son obligatorios.', uiState: 'validation_error' });
      return;
    }

    // 1. Validate role value against the known enum before anything else.
    if (!isValidRole(role)) {
      res.status(400).json({ success: false, statusCode: 'INVALID_ROLE', message: `El rol '${role}' no es válido.`, uiState: 'validation_error' });
      return;
    }

    // 2. Role assignment capability check — prevents privilege escalation.
    if (!canAssignRole(actor.role, role)) {
      res.status(403).json({ success: false, statusCode: 'ROLE_NOT_ASSIGNABLE', message: 'No tiene permisos para crear usuarios con ese rol.', uiState: 'unauthorized' });
      return;
    }

    // 3. Structural validation: each role requires the correct scope reference.
    const operationalRoles: UserRole[] = ['guardia', 'jefe_operaciones', 'admin'];
    if (operationalRoles.includes(role) && !branchId) {
      res.status(400).json({ success: false, statusCode: 'MISSING_BRANCH', message: `El rol '${role}' requiere una sucursal asignada.`, uiState: 'validation_error' });
      return;
    }
    if (role === 'admin_pais' && !countryId) {
      res.status(400).json({ success: false, statusCode: 'MISSING_COUNTRY', message: "El rol 'admin_pais' requiere un país asignado.", uiState: 'validation_error' });
      return;
    }

    // 4. Scope validation: actor can only create users within their own scope.
    //    For admin_pais creating an operational user, the supplied branchId must
    //    belong to their country. assertResourceInScope handles this correctly
    //    because scopeFromRequest returns the country scope for admin_pais.
    if (branchId && operationalRoles.includes(role)) {
      await assertResourceInScope(parseInt(branchId, 10), scopeFromRequest(req));
    }

    const passwordHash = await bcrypt.hash(password, 12);
    const user = await createUser({
      username,
      fullName,
      role:      role as UserRole,
      passwordHash,
      branchId:  branchId  ? parseInt(branchId,  10) : null,
      countryId: countryId ? parseInt(countryId, 10) : null,
    });

    res.status(201).json({
      success:    true,
      statusCode: 'USER_CREATED',
      message:    'Usuario creado.',
      uiState:    'saved_successfully',
      data:       { id: user.id, username: username.toLowerCase(), fullName, role },
    });
  } catch (err) { next(err); }
});

router.put('/users/:id', async (req, res, next) => {
  try {
    const actor  = req.user!;
    const target = await getUserById(req.params.id);

    // 1. No self-editing — a superior must manage your account.
    if (actor.userId === req.params.id) {
      res.status(403).json({ success: false, statusCode: 'SELF_EDIT_FORBIDDEN', message: 'No puede editar su propio usuario.', uiState: 'unauthorized' });
      return;
    }

    // 2. Peer-management rule: actor must have a strictly manageable relationship
    //    with the target's CURRENT role before any field is changed.
    if (!canManageUser(actor.role, target.role)) {
      res.status(403).json({ success: false, statusCode: 'ROLE_NOT_MANAGEABLE', message: 'No tiene permisos para gestionar este usuario.', uiState: 'unauthorized' });
      return;
    }

    // 3. If the role is being changed, the actor must also be able to assign the new role.
    const { password, fullName, role, active, branchId, countryId } = req.body;
    if (role !== undefined) {
      if (!isValidRole(role)) {
        res.status(400).json({ success: false, statusCode: 'INVALID_ROLE', message: `El rol '${role}' no es válido.`, uiState: 'validation_error' });
        return;
      }
      if (!canAssignRole(actor.role, role)) {
        res.status(403).json({ success: false, statusCode: 'ROLE_NOT_ASSIGNABLE', message: 'No tiene permisos para asignar ese rol.', uiState: 'unauthorized' });
        return;
      }
    }

    // 4. Scope check: target resource must be within the actor's scope.
    //    For admin_pais: validates the target's branch is in their country.
    //    For admin_global users (null branchId): only admin_global passes
    //    (assertResourceInScope throws 403 for non-global scopes when branchId is null).
    await assertResourceInScope(target.branchId ?? null, scopeFromRequest(req));

    const data: Parameters<typeof updateUser>[1] = {};
    if (fullName   !== undefined) data.fullName  = fullName;
    if (role       !== undefined) data.role      = role as UserRole;
    if (active     !== undefined) data.active    = active;
    if (branchId   !== undefined) data.branchId  = branchId  ? parseInt(branchId,  10) : null;
    if (countryId  !== undefined) data.countryId = countryId ? parseInt(countryId, 10) : null;
    if (password)                 data.passwordHash = await bcrypt.hash(password, 12);

    await updateUser(req.params.id, data);
    res.json({ success: true, statusCode: 'USER_UPDATED', message: 'Usuario actualizado.', uiState: 'saved_successfully' });
  } catch (err) { next(err); }
});

export default router;
