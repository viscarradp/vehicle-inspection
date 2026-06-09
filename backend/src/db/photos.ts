import sql from 'mssql';
import { getConn } from './connection';
import type { Photo, PhotoType } from '../types';

function isoDate(val: unknown): string {
  return val instanceof Date ? val.toISOString() : val as string;
}

function toPhoto(r: Record<string, unknown>): Photo {
  return {
    id:           String(r.Id),
    inspectionId: r.InspectionId != null ? String(r.InspectionId) : undefined,
    openIssueId:  r.OpenIssueId  != null ? String(r.OpenIssueId)  : undefined,
    vehicleId:    String(r.VehicleId),
    plate:        r.Plate        as string,
    type:         r.PhotoType    as PhotoType,
    fileName:     r.FileName     as string,
    storagePath:  r.StoragePath  as string,
    internalUrl:  (r.InternalUrl as string | null) ?? '',
    uploadedBy:   r.UploadedById != null ? String(r.UploadedById) : '',
    uploadedAt:   isoDate(r.UploadedAt),
  };
}

export async function createPhotoRecord(data: {
  inspectionId?: string | null;
  openIssueId?:  string | null;
  vehicleId:     string;
  plate:         string;
  photoType:     PhotoType;
  fileName:      string;
  storagePath:   string;
  internalUrl:   string;
  uploadedBy:    string;
}): Promise<{ id: string }> {
  const req = getConn();
  const uploadedById = parseInt(data.uploadedBy, 10);
  req.input('inspectionId', sql.Int,           data.inspectionId ? parseInt(data.inspectionId, 10) : null);
  req.input('openIssueId',  sql.Int,           data.openIssueId  ? parseInt(data.openIssueId, 10)  : null);
  req.input('vehicleId',    sql.Int,           parseInt(data.vehicleId, 10));
  req.input('plate',        sql.NVarChar(20),  data.plate);
  req.input('photoType',    sql.NVarChar(30),  data.photoType);
  req.input('fileName',     sql.NVarChar(255), data.fileName);
  req.input('storagePath',  sql.NVarChar(500), data.storagePath);
  req.input('internalUrl',  sql.NVarChar(500), data.internalUrl);
  req.input('uploadedById', sql.Int,           Number.isNaN(uploadedById) ? null : uploadedById);
  const result = await req.query(`
    INSERT INTO Photos
      (InspectionId, OpenIssueId, VehicleId, Plate, PhotoType, FileName, StoragePath, InternalUrl, UploadedById)
    OUTPUT INSERTED.Id
    VALUES
      (@inspectionId, @openIssueId, @vehicleId, @plate, @photoType, @fileName, @storagePath, @internalUrl, @uploadedById)
  `);
  return { id: String(result.recordset[0].Id) };
}

export async function getPhotosByInspection(inspectionId: string): Promise<Photo[]> {
  const req = getConn();
  req.input('id', sql.Int, parseInt(inspectionId, 10));
  const result = await req.query(`
    SELECT Id, InspectionId, OpenIssueId, VehicleId, Plate, PhotoType,
           FileName, StoragePath, InternalUrl, UploadedById, UploadedAt
    FROM Photos
    WHERE InspectionId = @id
    ORDER BY UploadedAt
  `);
  return result.recordset.map(toPhoto);
}

export async function getPhotosByOpenIssue(openIssueId: string): Promise<Photo[]> {
  const req = getConn();
  req.input('id', sql.Int, parseInt(openIssueId, 10));
  const result = await req.query(`
    SELECT Id, InspectionId, OpenIssueId, VehicleId, Plate, PhotoType,
           FileName, StoragePath, InternalUrl, UploadedById, UploadedAt
    FROM Photos
    WHERE OpenIssueId = @id
    ORDER BY UploadedAt
  `);
  return result.recordset.map(toPhoto);
}

/**
 * Looks up a photo by its storage path, scoped to the caller's tenant via RLS
 * on the Photos table (cross-tenant rows are filtered out → returns null).
 * Authorizes file serving so the storage path can't act as a bearer token that
 * exposes another tenant's images to any authenticated user.
 */
export async function getPhotoByStoragePath(storagePath: string): Promise<Photo | null> {
  const req = getConn();
  req.input('storagePath', sql.NVarChar(500), storagePath);
  const result = await req.query(`
    SELECT TOP 1 Id, InspectionId, OpenIssueId, VehicleId, Plate, PhotoType,
           FileName, StoragePath, InternalUrl, UploadedById, UploadedAt
    FROM Photos
    WHERE StoragePath = @storagePath
  `);
  return result.recordset[0] ? toPhoto(result.recordset[0]) : null;
}
