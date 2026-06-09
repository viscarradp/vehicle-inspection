import { Request, Response, NextFunction } from 'express';
import { z } from 'zod';
import {
  getVehicleStatusTypes,
  getAllVehicleStatusTypes,
  getVehicleStatusTypeById,
  createVehicleStatusType,
  updateVehicleStatusType,
  toggleVehicleStatusType,
  deleteVehicleStatusType,
} from '../db/vehicleStatusTypes';

const VALID_COLORS = ['blue', 'violet', 'indigo', 'cyan', 'orange', 'amber', 'emerald', 'red', 'slate'] as const;

const createSchema = z.object({
  labelEs:   z.string().min(2).max(100).trim(),
  color:     z.enum(VALID_COLORS),
  countryId: z.number().int().positive().optional(),
  sortOrder: z.number().int().min(0).optional(),
});

const updateSchema = z.object({
  labelEs:   z.string().min(2).max(100).trim().optional(),
  color:     z.enum(VALID_COLORS).optional(),
  sortOrder: z.number().int().min(0).optional(),
});

function toSlug(label: string): string {
  return label
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .slice(0, 45);
}

function requireCountryAdmin(req: Request, res: Response): boolean {
  const role = req.user!.role;
  if (role !== 'admin_pais' && role !== 'admin_global') {
    res.status(403).json({
      success: false, statusCode: 'FORBIDDEN',
      message: 'Solo administradores de país o global pueden gestionar tipos de estado.',
      uiState: 'unauthorized',
    });
    return false;
  }
  return true;
}

/** GET /vehicle-status-types — lista activos (cualquier rol autenticado). */
export async function listVehicleStatusTypes(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const countryId = req.user!.countryId ?? undefined;
    const types = await getVehicleStatusTypes(countryId);
    res.json({ success: true, statusCode: 'OK', message: 'OK', uiState: 'saved_successfully', data: types });
  } catch (err) { next(err); }
}

/** GET /vehicle-status-types/all — lista todos para admin (activos e inactivos). */
export async function listAllVehicleStatusTypes(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    if (!requireCountryAdmin(req, res)) return;
    // admin_pais ve los globales + los de su país; admin_global ve todos
    const countryId = req.user!.role === 'admin_global' ? undefined : (req.user!.countryId ?? undefined);
    const types = await getAllVehicleStatusTypes(countryId);
    res.json({ success: true, statusCode: 'OK', message: 'OK', uiState: 'saved_successfully', data: types });
  } catch (err) { next(err); }
}

/** POST /vehicle-status-types */
export async function createStatusType(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    if (!requireCountryAdmin(req, res)) return;

    const parsed = createSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({
        success: false, statusCode: 'VALIDATION_ERROR',
        message: 'Datos inválidos.', uiState: 'validation_error',
        errors: parsed.error.flatten().fieldErrors,
      });
      return;
    }
    const data = parsed.data;

    // admin_pais solo puede crear tipos para su propio país
    if (req.user!.role === 'admin_pais') {
      const userCountryId = req.user!.countryId;
      if (!userCountryId) {
        res.status(400).json({ success: false, statusCode: 'NO_COUNTRY', message: 'Usuario sin país asignado.', uiState: 'validation_error' });
        return;
      }
      data.countryId = userCountryId;
    }

    const key = toSlug(data.labelEs);
    if (!key) {
      res.status(400).json({ success: false, statusCode: 'INVALID_LABEL', message: 'La etiqueta no produce una clave válida.', uiState: 'validation_error' });
      return;
    }

    try {
      const created = await createVehicleStatusType({ ...data, key });
      res.status(201).json({ success: true, statusCode: 'CREATED', message: 'Tipo creado.', uiState: 'saved_successfully', data: created });
    } catch (err: unknown) {
      const msg = (err as { message?: string }).message ?? '';
      if (msg.includes('UQ_VehicleStatusTypes_Key')) {
        res.status(409).json({ success: false, statusCode: 'DUPLICATE_KEY', message: `Ya existe un estado con clave "${key}". Cambia el nombre.`, uiState: 'validation_error' });
        return;
      }
      throw err;
    }
  } catch (err) { next(err); }
}

/** PUT /vehicle-status-types/:id */
export async function updateStatusType(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    if (!requireCountryAdmin(req, res)) return;

    const id = parseInt(req.params.id, 10);
    if (isNaN(id)) { res.status(400).json({ success: false, statusCode: 'INVALID_ID', message: 'ID inválido.', uiState: 'validation_error' }); return; }

    const type = await getVehicleStatusTypeById(id);
    if (!type) { res.status(404).json({ success: false, statusCode: 'NOT_FOUND', message: 'Tipo no encontrado.', uiState: 'not_found' }); return; }

    // admin_pais solo puede editar tipos de su país (no los globales)
    if (req.user!.role === 'admin_pais' && type.countryId !== req.user!.countryId) {
      res.status(403).json({ success: false, statusCode: 'FORBIDDEN', message: 'No tienes permiso para editar este tipo.', uiState: 'unauthorized' });
      return;
    }

    const parsed = updateSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ success: false, statusCode: 'VALIDATION_ERROR', message: 'Datos inválidos.', uiState: 'validation_error', errors: parsed.error.flatten().fieldErrors });
      return;
    }

    await updateVehicleStatusType(id, parsed.data);
    res.json({ success: true, statusCode: 'UPDATED', message: 'Tipo actualizado.', uiState: 'saved_successfully' });
  } catch (err) { next(err); }
}

/** PATCH /vehicle-status-types/:id/toggle */
export async function toggleStatusType(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    if (!requireCountryAdmin(req, res)) return;

    const id = parseInt(req.params.id, 10);
    if (isNaN(id)) { res.status(400).json({ success: false, statusCode: 'INVALID_ID', message: 'ID inválido.', uiState: 'validation_error' }); return; }

    const type = await getVehicleStatusTypeById(id);
    if (!type) { res.status(404).json({ success: false, statusCode: 'NOT_FOUND', message: 'Tipo no encontrado.', uiState: 'not_found' }); return; }

    if (req.user!.role === 'admin_pais' && type.countryId !== req.user!.countryId) {
      res.status(403).json({ success: false, statusCode: 'FORBIDDEN', message: 'No tienes permiso para modificar este tipo.', uiState: 'unauthorized' });
      return;
    }

    await toggleVehicleStatusType(id, !type.active);
    res.json({ success: true, statusCode: 'UPDATED', message: `Tipo ${type.active ? 'desactivado' : 'activado'}.`, uiState: 'saved_successfully' });
  } catch (err) { next(err); }
}

/** DELETE /vehicle-status-types/:id */
export async function deleteStatusType(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    if (!requireCountryAdmin(req, res)) return;

    const id = parseInt(req.params.id, 10);
    if (isNaN(id)) { res.status(400).json({ success: false, statusCode: 'INVALID_ID', message: 'ID inválido.', uiState: 'validation_error' }); return; }

    const type = await getVehicleStatusTypeById(id);
    if (!type) { res.status(404).json({ success: false, statusCode: 'NOT_FOUND', message: 'Tipo no encontrado.', uiState: 'not_found' }); return; }

    if (type.isSystem) {
      res.status(409).json({ success: false, statusCode: 'SYSTEM_TYPE', message: 'Los tipos de sistema no pueden eliminarse. Puedes desactivarlos.', uiState: 'validation_error' });
      return;
    }

    if (req.user!.role === 'admin_pais' && type.countryId !== req.user!.countryId) {
      res.status(403).json({ success: false, statusCode: 'FORBIDDEN', message: 'No tienes permiso para eliminar este tipo.', uiState: 'unauthorized' });
      return;
    }

    const deleted = await deleteVehicleStatusType(id);
    if (!deleted) {
      res.status(409).json({ success: false, statusCode: 'SYSTEM_TYPE', message: 'No se pudo eliminar.', uiState: 'validation_error' });
      return;
    }
    res.json({ success: true, statusCode: 'DELETED', message: 'Tipo eliminado.', uiState: 'saved_successfully' });
  } catch (err) { next(err); }
}
