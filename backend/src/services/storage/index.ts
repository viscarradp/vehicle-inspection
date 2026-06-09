import type { PhotoStorage } from './PhotoStorage';
import { LocalPhotoStorage } from './localPhotoStorage';
import { GcsPhotoStorage } from './gcsPhotoStorage';

let instance: PhotoStorage | null = null;

/**
 * Devuelve la implementación de almacenamiento de fotos según STORAGE_DRIVER.
 *  - 'local' (default) → disco / volumen Docker `vi_uploads`.
 *  - 'gcs'             → Google Cloud Storage (stub; ver gcsPhotoStorage.ts).
 *
 * Singleton por proceso: el driver se resuelve una sola vez.
 */
export function getPhotoStorage(): PhotoStorage {
  if (instance) return instance;
  const driver = (process.env.STORAGE_DRIVER ?? 'local').toLowerCase();
  switch (driver) {
    case 'gcs':
      instance = new GcsPhotoStorage();
      break;
    case 'local':
    default:
      instance = new LocalPhotoStorage();
      break;
  }
  return instance;
}

export type { PhotoStorage, StoredPhoto } from './PhotoStorage';
