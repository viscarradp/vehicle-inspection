import type { Response } from 'express';
import type { PhotoStorage } from './PhotoStorage';

/**
 * Almacenamiento en Google Cloud Storage. STUB — pendiente de implementar.
 *
 * Activación (cuando se decida migrar):
 *  1. `npm i @google-cloud/storage`
 *  2. Credenciales: GOOGLE_APPLICATION_CREDENTIALS (service account JSON) o
 *     Workload Identity si corre en GKE/Cloud Run.
 *  3. Variables de entorno: GCS_BUCKET y, opcional, GCS_SIGNED_URL_TTL_MIN.
 *  4. Descomentar la implementación de abajo y eliminar los `throw`.
 *
 * No requiere cambios de BD: Photos.StoragePath ya es la object key del bucket
 * y Photos.InternalUrl ya guarda la URL resuelta. El frontend no se entera.
 *
 * Servido recomendado: signed URLs de corta duración generadas DESPUÉS de validar
 * el scope del usuario (mantiene el control de acceso por tenant que hay hoy) y
 * descarga al backend del tráfico de imágenes.
 */
export class GcsPhotoStorage implements PhotoStorage {
  // private bucket = new Storage().bucket(process.env.GCS_BUCKET!);

  async put(_storagePath: string, _data: Buffer): Promise<string> {
    // await this.bucket.file(_storagePath).save(_data, {
    //   contentType: 'image/jpeg',
    //   resumable: false,
    // });
    // Opción A (recomendada): servir vía proxy autenticado → internalUrl al endpoint propio,
    // que en `serve` redirige a una signed URL tras validar scope.
    //   return `${process.env.PUBLIC_BASE_URL}/api/photos/file/${_storagePath}`;
    throw new Error('GcsPhotoStorage.put no implementado todavía.');
  }

  async serve(_storagePath: string, _res: Response): Promise<void> {
    // const ttlMin = Number(process.env.GCS_SIGNED_URL_TTL_MIN ?? 15);
    // const [url] = await this.bucket.file(_storagePath).getSignedUrl({
    //   action: 'read',
    //   expires: Date.now() + ttlMin * 60_000,
    // });
    // _res.redirect(url);
    throw new Error('GcsPhotoStorage.serve no implementado todavía.');
  }
}
