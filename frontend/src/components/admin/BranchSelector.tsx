import { useEffect, useState, useMemo } from 'react';
import { Loader2, Building2 } from 'lucide-react';
import toast from 'react-hot-toast';

import { branchApi } from '@/api/endpoints';

export interface Branch {
  id: number;
  name: string;
  countryId?: number;
  countryName?: string;
}

export interface Country {
  id: number;
  name: string;
}

interface BranchSelectorProps {
  actorRole: string;
  branchId: string;
  onBranchChange: (id: string) => void;
  adminBranch?: Branch;
}

const labelCls =
  'mb-1 block text-xs font-semibold uppercase tracking-wider text-muted-foreground';
const selectCls =
  'w-full rounded-lg border border-border bg-background px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary disabled:opacity-50';

/** Selector contextual de sucursal según rol del actor (admin / admin_pais / admin_global). */
export function BranchSelector({
  actorRole,
  branchId,
  onBranchChange,
  adminBranch,
}: BranchSelectorProps) {
  const [branches, setBranches] = useState<Branch[]>([]);
  const [allBranches, setAllBranches] = useState<Branch[]>([]);
  const [countryNames, setCountryNames] = useState<Map<number, string>>(new Map());
  const [countryId, setCountryId] = useState('');
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (actorRole !== 'admin_pais') return;
    setLoading(true);
    branchApi
      .list()
      .then((r) => setBranches((r.data.data as Branch[]) ?? []))
      .catch(() => toast.error('No se pudieron cargar las sucursales.'))
      .finally(() => setLoading(false));
  }, [actorRole]);

  useEffect(() => {
    if (actorRole !== 'admin_global') return;
    setLoading(true);
    Promise.allSettled([branchApi.list(), branchApi.countries()])
      .then(([branchesRes, countriesRes]) => {
        if (branchesRes.status === 'fulfilled') {
          setAllBranches((branchesRes.value.data.data as Branch[]) ?? []);
        } else {
          toast.error('No se pudieron cargar las sucursales.');
        }
        if (countriesRes.status === 'fulfilled') {
          const list = (countriesRes.value.data.data as Country[]) ?? [];
          setCountryNames(new Map(list.map((c) => [c.id, c.name])));
        }
      })
      .finally(() => setLoading(false));
  }, [actorRole]);

  const derivedCountries = useMemo(() => {
    if (actorRole !== 'admin_global') return [];
    const map = new Map<number, string>();
    allBranches.forEach((b) => {
      if (b.countryId != null) {
        map.set(
          b.countryId,
          countryNames.get(b.countryId) ?? b.countryName ?? `País ${b.countryId}`,
        );
      }
    });
    return Array.from(map.entries()).map(([id, name]) => ({ id, name }));
  }, [allBranches, countryNames, actorRole]);

  const filteredBranches = useMemo(() => {
    if (actorRole !== 'admin_global' || !countryId) return [];
    return allBranches.filter((b) => String(b.countryId) === countryId);
  }, [allBranches, countryId, actorRole]);

  if (actorRole === 'admin') {
    return (
      <div>
        <label className={labelCls}>Sucursal</label>
        <div className="flex items-center gap-2 rounded-lg border border-border bg-muted/40 px-3 py-2 text-sm text-muted-foreground">
          <Building2 className="h-4 w-4 shrink-0" />
          <span>{adminBranch?.name ?? 'Sucursal asignada por tu cuenta'}</span>
          <span className="ml-auto text-xs opacity-50">asignada</span>
        </div>
      </div>
    );
  }

  if (actorRole === 'admin_pais') {
    return (
      <div>
        <label className={labelCls}>Sucursal</label>
        {loading ? (
          <div className="flex items-center gap-2 py-2 text-sm text-muted-foreground">
            <Loader2 className="h-4 w-4 animate-spin" /> Cargando sucursales…
          </div>
        ) : (
          <select
            className={selectCls}
            value={branchId}
            onChange={(e) => onBranchChange(e.target.value)}
          >
            <option value="">— Selecciona sucursal —</option>
            {branches.map((b) => (
              <option key={b.id} value={String(b.id)}>
                {b.name}
              </option>
            ))}
          </select>
        )}
      </div>
    );
  }

  if (actorRole === 'admin_global') {
    return (
      <>
        <div>
          <label className={labelCls}>País</label>
          {loading ? (
            <div className="flex items-center gap-2 py-2 text-sm text-muted-foreground">
              <Loader2 className="h-4 w-4 animate-spin" /> Cargando…
            </div>
          ) : (
            <select
              className={selectCls}
              value={countryId}
              onChange={(e) => {
                setCountryId(e.target.value);
                onBranchChange('');
              }}
            >
              <option value="">— Selecciona país —</option>
              {derivedCountries.map((c) => (
                <option key={c.id} value={String(c.id)}>
                  {c.name}
                </option>
              ))}
            </select>
          )}
        </div>
        {countryId && (
          <div>
            <label className={labelCls}>Sucursal</label>
            <select
              className={selectCls}
              value={branchId}
              onChange={(e) => onBranchChange(e.target.value)}
            >
              <option value="">— Selecciona sucursal —</option>
              {filteredBranches.map((b) => (
                <option key={b.id} value={String(b.id)}>
                  {b.name}
                </option>
              ))}
            </select>
          </div>
        )}
      </>
    );
  }

  return null;
}

interface CountrySelectorProps {
  countryId: string;
  onCountryChange: (id: string) => void;
}

/** Solo para admin_global al crear/editar admin_pais. */
export function CountrySelector({ countryId, onCountryChange }: CountrySelectorProps) {
  const [countries, setCountries] = useState<Country[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    branchApi
      .countries()
      .then((r) => setCountries((r.data.data as Country[]) ?? []))
      .catch(() => toast.error('No se pudieron cargar los países.'))
      .finally(() => setLoading(false));
  }, []);

  return (
    <div>
      <label className={labelCls}>País</label>
      {loading ? (
        <div className="flex items-center gap-2 py-2 text-sm text-muted-foreground">
          <Loader2 className="h-4 w-4 animate-spin" /> Cargando países…
        </div>
      ) : (
        <select
          className={selectCls}
          value={countryId}
          onChange={(e) => onCountryChange(e.target.value)}
        >
          <option value="">— Selecciona país —</option>
          {countries.map((c) => (
            <option key={c.id} value={String(c.id)}>
              {c.name}
            </option>
          ))}
        </select>
      )}
    </div>
  );
}

/** Carga sucursales y países una vez para lookups en listas. */
export function useBranchLookups(enabled: boolean) {
  const [branchMap, setBranchMap] = useState<Map<number, string>>(new Map());
  const [countryMap, setCountryMap] = useState<Map<number, string>>(new Map());

  useEffect(() => {
    if (!enabled) return;
    Promise.allSettled([branchApi.list(), branchApi.countries()]).then(
      ([branchesRes, countriesRes]) => {
        if (branchesRes.status === 'fulfilled') {
          const list = (branchesRes.value.data.data as Branch[]) ?? [];
          setBranchMap(new Map(list.map((b) => [b.id, b.name])));
        }
        if (countriesRes.status === 'fulfilled') {
          const list = (countriesRes.value.data.data as Country[]) ?? [];
          setCountryMap(new Map(list.map((c) => [c.id, c.name])));
        }
      },
    );
  }, [enabled]);

  return { branchMap, countryMap };
}
