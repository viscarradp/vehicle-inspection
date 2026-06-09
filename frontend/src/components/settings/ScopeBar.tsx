import { useState, useEffect } from 'react';
import type { UserRole, TargetScope } from '@/types';
import { branchApi } from '@/api/endpoints';
import { cn } from '@/lib/utils';

interface BranchOption  { id: number; name: string }
interface CountryOption { id: number; name: string }

type ActiveTab = 'global' | 'country' | 'branch';

interface ScopeBarProps {
  role:              UserRole;
  naturalCountryId?: number;
  selectedScope:     TargetScope;
  onScopeChange:     (scope: TargetScope) => void;
  /** Llamado cuando el tab activo requiere una selección adicional (dropdown) antes
   *  de tener un scope completo. Permite al padre limpiar el contenido stale. */
  onScopePending?:   () => void;
}

export function ScopeBar({ role, naturalCountryId, selectedScope, onScopeChange, onScopePending }: ScopeBarProps) {
  const isGlobal = role === 'admin_global';
  const [activeTab, setActiveTab]         = useState<ActiveTab>(selectedScope.level);
  const [countries, setCountries]         = useState<CountryOption[]>([]);
  const [branches, setBranches]           = useState<BranchOption[]>([]);
  const [selectedCountryId, setSelectedCountryId] = useState<number | null>(
    'countryId' in selectedScope ? selectedScope.countryId : (naturalCountryId ?? null)
  );
  const [selectedBranchId, setSelectedBranchId] = useState<number | null>(
    'branchId' in selectedScope ? selectedScope.branchId : null
  );
  const [loadingCountries, setLoadingCountries] = useState(false);
  const [loadingBranches,  setLoadingBranches]  = useState(false);

  // Cargar países cuando admin_global entra a tab país o sucursal
  useEffect(() => {
    if (!isGlobal || (activeTab !== 'country' && activeTab !== 'branch')) return;
    setLoadingCountries(true);
    branchApi.countries()
      .then(r => setCountries((r.data.data as CountryOption[]) ?? []))
      .catch(() => setCountries([]))
      .finally(() => setLoadingCountries(false));
  }, [isGlobal, activeTab]);

  // Para admin_pais, cargar sus sucursales cuando entra a tab branch
  useEffect(() => {
    if (isGlobal || activeTab !== 'branch' || !naturalCountryId) return;
    setLoadingBranches(true);
    branchApi.list({ countryId: naturalCountryId })
      .then(r => setBranches((r.data.data as BranchOption[]) ?? []))
      .catch(() => setBranches([]))
      .finally(() => setLoadingBranches(false));
  }, [isGlobal, activeTab, naturalCountryId]);

  // Para admin_global, cargar sucursales cuando selecciona un país en tab branch
  useEffect(() => {
    if (!isGlobal || activeTab !== 'branch' || !selectedCountryId) return;
    setLoadingBranches(true);
    branchApi.list({ countryId: selectedCountryId })
      .then(r => setBranches((r.data.data as BranchOption[]) ?? []))
      .catch(() => setBranches([]))
      .finally(() => setLoadingBranches(false));
  }, [isGlobal, activeTab, selectedCountryId]);

  function handleTabChange(tab: ActiveTab) {
    setActiveTab(tab);
    setSelectedBranchId(null);

    if (tab === 'global') {
      onScopeChange({ level: 'global' });
      return;
    }

    if (tab === 'country') {
      // admin_pais: país fijo y conocido → notificar inmediatamente
      if (!isGlobal && naturalCountryId) {
        setSelectedCountryId(naturalCountryId);
        onScopeChange({ level: 'country', countryId: naturalCountryId });
      }
      // admin_global: necesita elegir país en el dropdown → limpiar scope
      if (isGlobal) {
        setSelectedCountryId(null);
        onScopePending?.();
      }
      return;
    }

    // tab === 'branch': esperar selección de sucursal en dropdown → limpiar contenido
    if (tab === 'branch') {
      if (!isGlobal && naturalCountryId) setSelectedCountryId(naturalCountryId);
      onScopePending?.();
    }
  }

  function handleCountrySelect(e: React.ChangeEvent<HTMLSelectElement>) {
    const cid = Number(e.target.value);
    setSelectedCountryId(cid || null);
    setSelectedBranchId(null);
    setBranches([]);
    if (cid && activeTab === 'country') {
      onScopeChange({ level: 'country', countryId: cid });
    }
  }

  function handleBranchSelect(e: React.ChangeEvent<HTMLSelectElement>) {
    const bid = Number(e.target.value);
    setSelectedBranchId(bid || null);
    if (bid) {
      onScopeChange({ level: 'branch', branchId: bid });
    }
  }

  const tabs: { id: ActiveTab; label: string }[] = isGlobal
    ? [{ id: 'global', label: 'Global' }, { id: 'country', label: 'País' }, { id: 'branch', label: 'Sucursal' }]
    : [{ id: 'country', label: 'Mi País' }, { id: 'branch', label: 'Sucursal' }];

  return (
    <div className="flex items-center gap-4 border-b border-border bg-muted/30 px-6 py-2">
      {/* Tabs */}
      <div className="flex gap-1">
        {tabs.map(tab => (
          <button
            key={tab.id}
            onClick={() => handleTabChange(tab.id)}
            className={cn(
              'rounded-md px-3 py-1.5 text-sm font-medium transition-colors',
              activeTab === tab.id
                ? 'bg-card shadow-sm text-foreground'
                : 'text-muted-foreground hover:text-foreground',
            )}
          >
            {tab.label}
          </button>
        ))}
      </div>

      {/* Selector de país (admin_global en tab país o sucursal) */}
      {isGlobal && activeTab !== 'global' && (
        <select
          value={selectedCountryId ?? ''}
          onChange={handleCountrySelect}
          disabled={loadingCountries}
          className="input-box max-w-[200px]"
        >
          <option value="">{loadingCountries ? 'Cargando…' : 'Selecciona un país'}</option>
          {countries.map(c => (
            <option key={c.id} value={c.id}>{c.name}</option>
          ))}
        </select>
      )}

      {/* Selector de sucursal (cualquier rol en tab branch) */}
      {activeTab === 'branch' && (
        <select
          value={selectedBranchId ?? ''}
          onChange={handleBranchSelect}
          disabled={loadingBranches || (!isGlobal ? false : !selectedCountryId)}
          className="input-box max-w-[220px]"
        >
          <option value="">
            {loadingBranches
              ? 'Cargando…'
              : isGlobal && !selectedCountryId
              ? 'Selecciona un país primero'
              : 'Selecciona una sucursal'}
          </option>
          {branches.map(b => (
            <option key={b.id} value={b.id}>{b.name}</option>
          ))}
        </select>
      )}
    </div>
  );
}
