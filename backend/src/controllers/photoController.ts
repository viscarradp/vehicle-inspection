import { Request, Response, NextFunction } from 'express';
import multer from 'multer';
import {
  validatePhotoMime,
  validateMagicBytes,
  validateFileSize,
  storePhoto,
} from '../services/photoService';
import { getPhotoStorage } from '../services/storage';
import { createPhotoRecord, getPhotosByInspection, getPhotoByStoragePath } from '../db/photos';
import { getInspectionById, markHasPhotos } from '../db/inspections';
import { getTypedSettings } from '../db/settings';
import { getBranchTimezone } from '../db/branches';
import { getDateInTimezone, getHourInTimezone, resolveShift } from '../db/timezone';
import { resolveScope } from '../middleware/tenantScope';
import type { PhotoType } from '../types';

const SUPERVISOR_ROLES = ['jefe_operaciones', 'admin', 'admin_pais', 'admin_global'];

export async function servePhoto(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const relativePath = (req.params as Record<string, string>)[0] ?? '';
    // Authorize by tenant: only serve a file whose Photos row is visible under
    // the caller's RLS scope. Without this the storage path acted as an
    // unauthenticated bearer token that leaked images across branches.
    const photo = await getPhotoByStoragePath(relativePath);
    if (!photo) {
      res.status(404).json({ success: false, statusCode: 'NOT_FOUND', message: 'Foto no encontrada.', uiState: 'not_found' });
      return;
    }
    await getPhotoStorage().serve(relativePath, res);
  } catch (err) {
    next(err);
  }
}

export const upload = multer({
  storage: multer.memoryStorage(),
  // Hard cap = registry max for max_photo_size_mb. The per-branch configured
  // value (≤ this) is enforced in uploadPhoto once the inspection's branch is known.
  limits:  { fileSize: 50 * 1024 * 1024 },
});

export async function uploadPhoto(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const { id: inspectionId } = req.params;

    // Scope guard — la inspección debe pertenecer al tenant del usuario.
    const inspection = await getInspectionById(inspectionId, resolveScope(req.user!));
    if (!inspection) {
      res.status(404).json({ success: false, statusCode: 'NOT_FOUND', message: 'Inspección no encontrada.', uiState: 'not_found' }); return;
    }
    // Sellado por turno: un guardia solo puede adjuntar fotos a una inspección
    // de su turno actual. Las de turnos pasados quedan selladas (solo supervisor).
    const timezone = await getBranchTimezone(inspection.branchId);
    const settings = await getTypedSettings(inspection.branchId);
    const now      = new Date();
    const localDate = getDateInTimezone(now, timezone);
    const shift     = resolveShift(getHourInTimezone(now, timezone), settings);
    const isSealed  = inspection.localDate !== localDate || inspection.shift !== shift;
    if (isSealed && !SUPERVISOR_ROLES.includes(req.user!.role)) {
      res.status(403).json({ success: false, statusCode: 'INSPECTION_SEALED', message: 'El turno ya cerró. Solo un supervisor puede modificar esta inspección.', uiState: 'unauthorized' }); return;
    }

    const file = req.file;
    if (!file) {
      res.status(400).json({ success: false, statusCode: 'NO_FILE', message: 'No se recibió ningún archivo.', uiState: 'validation_error' }); return;
    }
    if (!validatePhotoMime(file.mimetype)) {
      res.status(400).json({ success: false, statusCode: 'INVALID_FORMAT', message: 'Formato no permitido. Use JPG, PNG o WebP.', uiState: 'validation_error' }); return;
    }
    if (!validateMagicBytes(file.buffer)) {
      res.status(400).json({ success: false, statusCode: 'INVALID_FILE_CONTENT', message: 'El archivo no es una imagen válida.', uiState: 'validation_error' }); return;
    }
    if (!validateFileSize(file.buffer)) {
      res.status(400).json({ success: false, statusCode: 'FILE_TOO_LARGE', message: 'El archivo es demasiado grande. Máximo 50MB.', uiState: 'validation_error' }); return;
    }
    // Per-branch configurable limit (max_photo_size_mb), resolved via cascade.
    const maxBytes = settings.max_photo_size_mb * 1024 * 1024;
    if (file.buffer.length > maxBytes) {
      res.status(400).json({ success: false, statusCode: 'FILE_TOO_LARGE', message: `El archivo supera el máximo configurado de ${settings.max_photo_size_mb} MB.`, uiState: 'validation_error' }); return;
    }

    const photoType: PhotoType = (req.body.photoType as PhotoType) ?? 'other';
    // Vehicle identity comes from the inspection (server-side), never from the
    // client body — otherwise a photo could be attached with another vehicle's id.
    const plate:     string    = inspection.plate;
    const vehicleId: string    = inspection.vehicleId;

    const { fileName, storagePath, internalUrl } = await storePhoto(file.buffer, plate, photoType);

    const { id: photoId } = await createPhotoRecord({
      inspectionId,
      vehicleId,
      plate,
      photoType,
      fileName,
      storagePath,
      internalUrl,
      uploadedBy: req.user!.userId,
    });

    await markHasPhotos(inspectionId);

    res.json({
      success: true,
      statusCode: 'PHOTO_UPLOADED',
      message: 'Foto subida correctamente.',
      uiState: 'photo_uploaded',
      data: { photoId, fileName, internalUrl },
    });
  } catch (err) {
    next(err);
  }
}

export async function getInspectionPhotos(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    // Scope check — don't serve photos for inspections outside the caller's tenant
    const inspection = await getInspectionById(req.params.id, resolveScope(req.user!));
    if (!inspection) {
      res.status(404).json({ success: false, statusCode: 'NOT_FOUND', message: 'Inspección no encontrada.', uiState: 'not_found' }); return;
    }
    const photos = await getPhotosByInspection(req.params.id);
    res.json({ success: true, statusCode: 'OK', message: `${photos.length} foto(s) encontrada(s).`, uiState: 'saved_successfully', data: photos });
  } catch (err) {
    next(err);
  }
}
