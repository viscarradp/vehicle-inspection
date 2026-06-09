import { useState, useEffect } from 'react';
import { vehicleStatusTypeApi } from '@/api/endpoints';
import type { VehicleStatusType } from '@/types';

// Caché en módulo: se carga una sola vez por sesión del navegador.
// Se invalida si el componente llama a `refresh()`.
let cache: VehicleStatusType[] | null = null;
let inflight: Promise<VehicleStatusType[]> | null = null;

async function fetchTypes(): Promise<VehicleStatusType[]> {
  if (cache) return cache;
  if (!inflight) {
    inflight = vehicleStatusTypeApi.list()
      .then(r => {
        cache = r.data.data as VehicleStatusType[];
        inflight = null;
        return cache;
      })
      .catch(err => {
        inflight = null;
        throw err;
      });
  }
  return inflight;
}

export function invalidateVehicleStatusTypesCache(): void {
  cache = null;
  inflight = null;
}

export function useVehicleStatusTypes() {
  const [types, setTypes]     = useState<VehicleStatusType[]>(cache ?? []);
  const [loading, setLoading] = useState(!cache);
  const [error, setError]     = useState(false);

  useEffect(() => {
    if (cache) { setTypes(cache); setLoading(false); return; }
    setLoading(true);
    fetchTypes()
      .then(t => { setTypes(t); setLoading(false); })
      .catch(() => { setError(true); setLoading(false); });
  }, []);

  const refresh = () => {
    invalidateVehicleStatusTypesCache();
    setLoading(true);
    fetchTypes()
      .then(t => { setTypes(t); setLoading(false); })
      .catch(() => { setError(true); setLoading(false); });
  };

  return { types, loading, error, refresh };
}
