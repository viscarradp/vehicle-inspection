import { useEffect, useState } from 'react';
import { settingsApi } from '@/api/endpoints';
import type { SettingKey, SettingMeta } from '@/types';

/**
 * Subconjunto de settings que el formulario de inspección necesita.
 * Solo las claves con efecto real en el flujo del guardia.
 */
export interface InspectionSettings {
  unusually_high_mileage_threshold: number;
}

const DEFAULTS: InspectionSettings = {
  unusually_high_mileage_threshold: 500,
};

/**
 * Obtiene los settings de la sucursal del usuario autenticado.
 *
 * El endpoint GET /settings (sin parámetros de scope) devuelve cada clave
 * como `SettingMeta { value, source, canEdit, … }`. Este hook extrae
 * únicamente `.value` de las claves relevantes para el formulario del guardia
 * y devuelve un objeto plano tipado.
 *
 * - Si la petición falla, se retorna `DEFAULTS` para que el formulario
 *   siga funcionando con valores conservadores.
 * - `loading` permite al consumidor no renderizar hasta tener los valores.
 */
export function useInspectionSettings(): {
  settings: InspectionSettings;
  loading:  boolean;
} {
  const [settings, setSettings] = useState<InspectionSettings>(DEFAULTS);
  const [loading,  setLoading]  = useState(true);

  useEffect(() => {
    settingsApi.get()
      .then(res => {
        const raw = res.data.data as Record<SettingKey, SettingMeta>;
        setSettings({
          unusually_high_mileage_threshold:
            (raw.unusually_high_mileage_threshold?.value as number) ?? DEFAULTS.unusually_high_mileage_threshold,
        });
      })
      .catch(() => {
        // Fallback a defaults — el formulario sigue operativo
        setSettings(DEFAULTS);
      })
      .finally(() => setLoading(false));
  }, []);

  return { settings, loading };
}
