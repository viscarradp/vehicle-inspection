import type { Response } from 'express';

/** Resultado de persistir una foto, agnóstico al backend de almacenamiento. */
export interface StoredPhoto {
  /** Llave/ruta relativa del objeto. Se guarda en Photos.StoragePath. */
  storagePath: string;
  /** URL resuelta para que el cliente acceda a la foto. Se guarda en Photos.InternalUrl. */
  internalUrl: string;
}

/**
 * Abstracción de almacenamiento de fotos. Permite intercambiar el backend
 * (disco local, GCS, S3, …) sin tocar controllers ni la tabla Photos.
 *
 * Contrato:
 *  - `put` recibe bytes YA comprimidos/listos y los persiste bajo `storagePath`.
 *  - `serve` entrega el objeto al cliente (stream directo o redirect a signed URL).
 *  - `storagePath` es la fuente de verdad portable; `internalUrl` se deriva de él.
 *
 * Como Photos.StoragePath ya almacena la llave portable, cambiar de driver NO
 * requiere migración de esquema — solo (opcionalmente) mover los bytes existentes.
 */
export interface PhotoStorage {
  /** Persiste los bytes bajo la llave dada y devuelve la URL para alcanzarlos. */
  put(storagePath: string, data: Buffer): Promise<string>;
  /** Entrega el objeto identificado por `storagePath` a la respuesta HTTP. */
  serve(storagePath: string, res: Response): Promise<void>;
}
