import type { PhotoType } from '../types';
import { getPhotoStorage } from './storage';

let sharp: ((buf: Buffer) => { resize: (o: object) => { jpeg: (o: object) => { toBuffer: () => Promise<Buffer> } } }) | null = null;
try {
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  sharp = require('sharp');
} catch {
  console.log('[photos] sharp not available — photos saved without compression');
}

const ALLOWED_MIME    = ['image/jpeg', 'image/jpg', 'image/png', 'image/webp'];
const MAX_RAW_BYTES   = 50 * 1024 * 1024;  // tope duro absoluto = máximo del registry (max_photo_size_mb)
const TARGET_WIDTH    = 1280;

export function validatePhotoMime(mimetype: string): boolean {
  return ALLOWED_MIME.includes(mimetype);
}

const MAGIC_BYTES: { sig: number[] }[] = [
  { sig: [0xFF, 0xD8, 0xFF] },
  { sig: [0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A] },
];

export function validateMagicBytes(buffer: Buffer): boolean {
  if (buffer.length < 12) return false;
  const isJpegOrPng = MAGIC_BYTES.some(({ sig }) => sig.every((byte, i) => buffer[i] === byte));
  const isWebP      = buffer.subarray(0, 4).toString('ascii') === 'RIFF' &&
                      buffer.subarray(8, 12).toString('ascii') === 'WEBP';
  return isJpegOrPng || isWebP;
}

export function validateFileSize(buffer: Buffer): boolean {
  return buffer.length <= MAX_RAW_BYTES;
}

async function compressPhoto(buffer: Buffer): Promise<Buffer> {
  if (!sharp) return buffer;
  return sharp(buffer)
    .resize({ width: TARGET_WIDTH, withoutEnlargement: true })
    .jpeg({ quality: 80, progressive: true })
    .toBuffer();
}

/**
 * Construye la llave portable del objeto: `año/mes/día/placa/archivo.jpg`.
 * Siempre con '/' — es una object key agnóstica al SO, no una ruta de disco.
 */
function buildPhotoKey(plate: string, photoType: PhotoType): { storagePath: string; fileName: string } {
  const now       = new Date();
  const year      = String(now.getFullYear());
  const month     = String(now.getMonth() + 1).padStart(2, '0');
  const day       = String(now.getDate()).padStart(2, '0');
  const dateStr   = `${year}${month}${day}`;
  const timestamp = Date.now();
  const safePlate = plate.replace(/[^a-zA-Z0-9-]/g, '_');
  const fileName  = `${dateStr}_${safePlate}_${photoType}_${timestamp}.jpg`;
  const storagePath = [year, month, day, safePlate, fileName].join('/');
  return { storagePath, fileName };
}

/**
 * Comprime y persiste la foto usando el driver de almacenamiento configurado
 * (STORAGE_DRIVER). El controller no necesita saber si es disco local o GCS.
 */
export async function storePhoto(
  buffer:    Buffer,
  plate:     string,
  photoType: PhotoType,
): Promise<{ fileName: string; storagePath: string; internalUrl: string }> {
  const compressed = await compressPhoto(buffer);
  const { storagePath, fileName } = buildPhotoKey(plate, photoType);
  const internalUrl = await getPhotoStorage().put(storagePath, compressed);
  return { fileName, storagePath, internalUrl };
}
