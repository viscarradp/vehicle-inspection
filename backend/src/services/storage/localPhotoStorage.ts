import path from 'path';
import fs from 'fs';
import type { Response } from 'express';
import type { PhotoStorage } from './PhotoStorage';

const UPLOADS_DIR = path.join(process.cwd(), 'uploads');

function ensureDir(dir: string): void {
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
}

/** Evita directory traversal: la ruta debe quedar contenida en UPLOADS_DIR. */
function isSafeRelativePath(relativePath: string): boolean {
  if (relativePath.split('/').some(seg => seg === '..' || seg === '.')) return false;
  const absolute = path.join(UPLOADS_DIR, relativePath);
  return absolute.startsWith(UPLOADS_DIR + path.sep) || absolute === UPLOADS_DIR;
}

/**
 * Almacenamiento en disco local. En producción el directorio `uploads/` se
 * monta como volumen Docker (`vi_uploads`) compartido con Nginx.
 */
export class LocalPhotoStorage implements PhotoStorage {
  async put(storagePath: string, data: Buffer): Promise<string> {
    const absolute = path.join(UPLOADS_DIR, storagePath);
    ensureDir(path.dirname(absolute));
    fs.writeFileSync(absolute, data);
    const baseUrl = process.env.PUBLIC_BASE_URL ?? `http://localhost:${process.env.PORT ?? 3001}`;
    return `${baseUrl}/api/photos/file/${storagePath}`;
  }

  async serve(storagePath: string, res: Response): Promise<void> {
    if (!isSafeRelativePath(storagePath)) {
      res.status(400).json({ success: false, message: 'Ruta inválida.' });
      return;
    }
    const absolute = path.join(UPLOADS_DIR, storagePath);
    res.sendFile(absolute, err => {
      if (err) res.status(404).json({ success: false, message: 'Foto no encontrada.' });
    });
  }

  async read(storagePath: string): Promise<Buffer> {
    if (!isSafeRelativePath(storagePath)) {
      throw new Error(`Ruta de foto inválida: ${storagePath}`);
    }
    return fs.promises.readFile(path.join(UPLOADS_DIR, storagePath));
  }
}
