import { useEffect, useState, useCallback } from 'react';
import toast from 'react-hot-toast';
import {
  Search, Loader2, Car, AlertTriangle, RotateCcw,
  MinusCircle, HelpCircle, Check, RefreshCw, Activity,
} from 'lucide-react';

import { useAuth }               from '@/context/AuthContext';
import { inspectionApi, vehicleApi } from '@/api/endpoints';
import { useVehicleStatusTypes } from '@/hooks/useVehicleStatusTypes';
import { AusenteModal, type AusenteData } from '@/components/AusenteModal';
import { StatusBadge, getVehicleStatusStyle } from '@/components/StatusBadge';
import { BranchSelector }        from '@/components/admin/BranchSelector';
import { PageHeader }            from '@/components/layouts/OpsShell';
import { Card }                  from '@/components/ui/card';
import { Button }                from '@/components/ui/button';
import { Input }                 from '@/components/ui/input';
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { cn }                    from '@/lib/utils';
import { shiftLabel }            from '@/lib/shifts';
import type { VehicleDashboardCard, GuardDashboard, VehicleStatusType } from '@/types';

// ─── Filtros (duplicados de Dashboard — desacoplados a propósito) ─────────────

type FilterKey = 'todos' | 'sin_revisar' | 'fuera' | 'revisado';

const FILTER_LABELS: Record<FilterKey, string> = {
  todos:       'Todos',
  sin_revisar: 'Sin revisar',
  fuera:       'Ausentes',
  revisado:    'Registrados',
};

function matchesFilter(card: VehicleDashboardCard, f: FilterKey): boolean {
  if (f === 'todos')       return true;
  if (f === 'sin_revisar') return card.currentStatus === 'active' && card.todayRecord.kind === 'none';
  if (f === 'fuera')       return card.currentStatus !== 'active';
  if (f === 'revisado')    return card.todayRecord.kind !== 'none';
  return false;
}

function countByFilter(vehicles: VehicleDashboardCard[], f: FilterKey): number {
  return vehicles.filter(v => matchesFilter(v, f)).length;
}

function sortVehicles(list: VehicleDashboardCard[]): VehicleDashboardCard[] {
  const score = (v: VehicleDashboardCard) => {
    if (v.todayRecord.kind !== 'none') return 3;
    if (v.currentStatus !== 'active')  return 2;
    return 1;
  };
  return [...list].sort((a, b) => score(a) - score(b));
}

// ─── FleetCard (simplificada — solo lectura + cambio de estado) ───────────────

function FleetCard({
  card,
  statusTypes,
  onChangeStatus,
}: {
  card: VehicleDashboardCard;
  statusTypes: VehicleStatusType[];
  onChangeStatus: () => void;
}) {
  const { currentStatus, todayRecord } = card;
  const isAbsent = currentStatus !== 'active';
  const kind     = todayRecord.kind;

  return (
    <Card className="flex flex-col gap-3 p-5 shadow-sm transition-shadow hover:shadow-md">
      {/* Encabezado: placa + badge */}
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="font-mono text-2xl font-bold leading-none tracking-tight tabular-nums">
            {card.plate}
          </div>
          <div className="mt-1 truncate text-sm text-muted-foreground">
            {card.vehicleType}{card.brand ? ` · ${card.brand}` : ''}
          </div>
        </div>

        {isAbsent ? (
          <StatusBadge status={currentStatus} statusTypes={statusTypes} className="shrink-0" />
        ) : kind === 'received' ? (
          <span className="shrink-0 rounded-full border border-emerald-200 bg-emerald-50 px-3 py-1 text-xs font-semibold text-emerald-700">
            Registrado hoy
          </span>
        ) : kind === 'never_left' ? (
          <span className="shrink-0 rounded-full border border-slate-300 bg-slate-50 px-3 py-1 text-xs font-semibold text-slate-500">
            No salió hoy
          </span>
        ) : kind === 'not_returned' ? (
          <span className="shrink-0 rounded-full border border-orange-200 bg-orange-50 px-3 py-1 text-xs font-semibold text-orange-700">
            No retornó
          </span>
        ) : kind === 'other' ? (
          <span className="shrink-0 rounded-full border border-zinc-300 bg-zinc-50 px-3 py-1 text-xs font-semibold text-zinc-600">
            Otro motivo
          </span>
        ) : (
          <span className="shrink-0 rounded-full border border-slate-300 bg-slate-50 px-3 py-1 text-xs font-semibold text-slate-600">
            Sin registrar
          </span>
        )}
      </div>

      {/* Banner de estado persistente */}
      {isAbsent && (() => {
        const style = getVehicleStatusStyle(currentStatus, statusTypes);
        return (
          <div className={cn('flex items-center gap-2 rounded-md border px-3 py-2 text-sm font-medium', style.badge)}>
            <RotateCcw className="h-3.5 w-3.5 shrink-0" />
            Estado fijo
            {card.currentStatusExpectedReturn && (
              <span className="ml-auto font-mono text-xs opacity-80">
                ret. {card.currentStatusExpectedReturn.split('T')[0]}
              </span>
            )}
          </div>
        );
      })()}

      {/* Banner no salió */}
      {!isAbsent && kind === 'never_left' && (
        <div className="flex items-center gap-2 rounded-md border border-slate-200 bg-slate-50 px-3 py-2 text-sm text-slate-600">
          <MinusCircle className="h-3.5 w-3.5 shrink-0" />
          Sin actividad hoy
        </div>
      )}

      {/* Banner no retornó / otro */}
      {!isAbsent && (kind === 'not_returned' || kind === 'other') && (
        <div className="flex items-center gap-2 rounded-md border border-orange-200 bg-orange-50 px-3 py-2 text-sm text-orange-700">
          <HelpCircle className="h-3.5 w-3.5 shrink-0" />
          {kind === 'not_returned' ? 'No retornó hoy' : 'Otro motivo registrado'}
        </div>
      )}

      {/* Banner registrado OK */}
      {!isAbsent && kind === 'received' && (
        <div className="flex items-center gap-2 rounded-md border border-emerald-200 bg-emerald-50 px-3 py-2 text-sm font-medium text-emerald-700">
          <Check className="h-3.5 w-3.5 shrink-0" />
          Inspección registrada este turno
        </div>
      )}

      {/* Alertas */}
      {card.hasOpenIssues && (
        <div className="flex items-center gap-2 rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm font-semibold text-red-700">
          <AlertTriangle className="h-4 w-4" />
          Daño abierto pendiente
        </div>
      )}
      {card.noReviewAlert && !isAbsent && kind === 'none' && (
        <div className="flex items-center gap-2 rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-sm font-medium text-amber-700">
          <AlertTriangle className="h-3.5 w-3.5" />
          Sin inspección reciente
        </div>
      )}

      {/* Acción: solo cambio de estado para ausentes */}
      {isAbsent && (
        <div className="mt-auto pt-1">
          <Button size="sm" variant="outline" className="w-full text-sm" onClick={onChangeStatus}>
            Cambiar estado
          </Button>
        </div>
      )}
    </Card>
  );
}

// ─── FleetMonitorPage ─────────────────────────────────────────────────────────

export function FleetMonitorPage() {
  const { user, isCountryScope } = useAuth();
  const { types: statusTypes }   = useVehicleStatusTypes();

  const [dashboard, setDashboard]       = useState<GuardDashboard | null>(null);
  const [loading, setLoading]           = useState(false);
  const [filter, setFilter]             = useState<FilterKey>('todos');
  const [search, setSearch]             = useState('');
  const [ausenteCard, setAusenteCard]   = useState<VehicleDashboardCard | null>(null);
  const [selectedBranch, setSelectedBranch] = useState('');

  // Para roles con sucursal propia, cargamos automáticamente.
  // Para admin_pais/admin_global, esperan a seleccionar una sucursal.
  const effectiveBranchId = isCountryScope
    ? (selectedBranch ? parseInt(selectedBranch, 10) : undefined)
    : undefined; // roles con sucursal no pasan branchId — el backend usa la del token

  const loadDashboard = useCallback(async (branchId?: number) => {
    setLoading(true);
    try {
      const res = await inspectionApi.dashboard(branchId);
      const data = res.data.data as GuardDashboard;
      data.vehicles = data.vehicles.map(v =>
        v.todayRecord ? v : { ...v, todayRecord: { kind: 'none' as const } }
      );
      setDashboard(data);
    } catch {
      setDashboard(null);
    } finally {
      setLoading(false);
    }
  }, []);

  // Auto-load para roles con sucursal
  useEffect(() => {
    if (!isCountryScope) {
      loadDashboard();
    }
  }, [isCountryScope, loadDashboard]);

  // Cargar al seleccionar sucursal para roles sin sucursal
  useEffect(() => {
    if (isCountryScope && effectiveBranchId) {
      loadDashboard(effectiveBranchId);
    }
  }, [isCountryScope, effectiveBranchId, loadDashboard]);

  const vehicles = dashboard?.vehicles ?? [];
  const counts   = dashboard?.counts ?? { total: 0, seen: 0, unseen: 0 };

  const sorted  = sortVehicles(vehicles);
  const visible = sorted.filter(v => {
    if (search && !v.plate.toLowerCase().includes(search.toLowerCase())) return false;
    return matchesFilter(v, filter);
  });

  /** Cambio de estado desde la FleetCard (mismo handler que Dashboard.handleAusente). */
  const handleAusente = async (data: AusenteData) => {
    if (!ausenteCard) return;
    const plate = ausenteCard.plate;
    try {
      if (data.kind === 'status' && data.vehicleStatus) {
        const reason = [data.note, data.authorizedBy ? `Autorizó: ${data.authorizedBy}` : '']
          .filter(Boolean).join(' · ') || undefined;
        await vehicleApi.setStatus(ausenteCard.vehicleId, {
          status: data.vehicleStatus, reason, expectedReturnDate: data.expectedReturnDate,
        });
      } else {
        await inspectionApi.save({
          vehicleId:          ausenteCard.vehicleId,
          plate,
          returnStatus:       data.returnStatus ?? 'other',
          authorizedBy:       data.authorizedBy,
          expectedReturnDate: data.expectedReturnDate,
          generalObservation: data.note,
        });
      }
      setAusenteCard(null);
      loadDashboard(effectiveBranchId);
      toast.success(`${plate} actualizado.`);
    } catch (err: unknown) {
      const msg = (err as { response?: { data?: { message?: string } } }).response?.data?.message;
      toast.error(msg ?? 'Error al registrar.');
    }
  };

  // ── Títulos dinámicos ──────────────────────────────────────────────────────

  const shiftInfo = dashboard
    ? `Turno ${shiftLabel(dashboard.shift)} · ${dashboard.localDate}`
    : undefined;

  const needsBranchSelection = isCountryScope && !effectiveBranchId;

  return (
    <div className="flex flex-1 flex-col overflow-hidden">
      <PageHeader
        title="Estado de flota"
        subtitle={shiftInfo ?? 'Vista en tiempo real del estado de la flota'}
        action={
          dashboard && (
            <button
              onClick={() => loadDashboard(effectiveBranchId)}
              className="flex items-center gap-1.5 rounded-lg border border-border px-3 py-2 text-sm text-muted-foreground hover:bg-muted"
            >
              <RefreshCw className="h-4 w-4" />
              Actualizar
            </button>
          )
        }
      />

      {/* Selector de sucursal para admin_pais / admin_global */}
      {isCountryScope && (
        <div className="flex flex-shrink-0 items-end gap-4 border-b border-border bg-card px-6 py-4">
          <BranchSelector
            actorRole={user?.role ?? ''}
            branchId={selectedBranch}
            onBranchChange={setSelectedBranch}
          />
        </div>
      )}

      {needsBranchSelection ? (
        <div className="flex flex-1 items-center justify-center p-6">
          <div className="w-full max-w-md rounded-xl border border-border bg-card p-8 text-center shadow-sm">
            <div className="mx-auto mb-4 flex h-16 w-16 items-center justify-center rounded-full bg-muted">
              <Activity className="h-8 w-8 text-muted-foreground" />
            </div>
            <h2 className="mb-2 text-xl font-semibold">Selecciona una sucursal</h2>
            <p className="leading-relaxed text-muted-foreground">
              Elige una sucursal en el panel superior para ver el estado de su flota.
            </p>
          </div>
        </div>
      ) : loading ? (
        <div className="flex flex-1 flex-col items-center justify-center gap-3 text-muted-foreground">
          <Loader2 className="h-9 w-9 animate-spin" />
          <span className="text-base">Cargando flota…</span>
        </div>
      ) : !dashboard ? (
        <div className="flex flex-1 items-center justify-center p-6">
          <div className="w-full max-w-md rounded-xl border border-border bg-card p-8 text-center shadow-sm">
            <div className="mx-auto mb-4 flex h-16 w-16 items-center justify-center rounded-full bg-muted">
              <Car className="h-8 w-8 text-muted-foreground" />
            </div>
            <h2 className="mb-2 text-xl font-semibold">No se pudo cargar la flota</h2>
            <p className="mb-7 leading-relaxed text-muted-foreground">
              Verifica tu conexión o que la sucursal esté configurada correctamente.
            </p>
            <Button size="touch" className="w-full" onClick={() => loadDashboard(effectiveBranchId)}>
              Reintentar
            </Button>
          </div>
        </div>
      ) : (
        <>
          {/* Filtros + búsqueda */}
          <div className="flex flex-shrink-0 flex-wrap items-center gap-3 border-b border-border bg-card px-6 py-3">
            <Tabs value={filter} onValueChange={v => setFilter(v as FilterKey)}>
              <TabsList className="h-10">
                {(['todos', 'sin_revisar', 'fuera', 'revisado'] as FilterKey[]).map(f => (
                  <TabsTrigger key={f} value={f}>
                    {FILTER_LABELS[f]}
                    {countByFilter(vehicles, f) > 0 && (
                      <span className="ml-1.5 font-mono text-xs tabular-nums opacity-60">
                        {countByFilter(vehicles, f)}
                      </span>
                    )}
                  </TabsTrigger>
                ))}
              </TabsList>
            </Tabs>
            <div className="relative ml-auto w-full max-w-xs">
              <Search className="pointer-events-none absolute left-3 top-1/2 h-5 w-5 -translate-y-1/2 text-muted-foreground" />
              <Input
                className="h-10 pl-10 text-sm"
                placeholder="Buscar placa…"
                value={search}
                onChange={e => setSearch(e.target.value)}
                inputMode="search"
              />
            </div>
          </div>

          {/* Grid de vehículos */}
          <div className="flex-1 overflow-auto p-6">
            {visible.length === 0 ? (
              <div className="pt-12 text-center text-base text-muted-foreground">
                No hay vehículos para este filtro.
              </div>
            ) : (
              <div className="grid grid-cols-1 gap-5 sm:grid-cols-2 xl:grid-cols-3 2xl:grid-cols-4">
                {visible.map(card => (
                  <FleetCard
                    key={card.vehicleId}
                    card={card}
                    statusTypes={statusTypes}
                    onChangeStatus={() => setAusenteCard(card)}
                  />
                ))}
              </div>
            )}
          </div>

          {/* Footer con contadores */}
          <footer className="flex flex-shrink-0 items-center gap-6 border-t border-border bg-muted/40 px-6 py-3">
            <div className="flex-1">
              <p className="text-sm text-foreground">
                <b className="font-mono tabular-nums">{counts.seen}</b> de{' '}
                <b className="font-mono tabular-nums">{counts.total}</b> registrados hoy
                {counts.unseen > 0 && (
                  <span className="text-muted-foreground">
                    {' '}· <b className="font-mono tabular-nums">{counts.unseen}</b> sin registrar
                  </span>
                )}
              </p>
              <div className="mt-1.5 h-2 overflow-hidden rounded-full bg-secondary">
                <div
                  className="h-full rounded-full bg-primary transition-all duration-500"
                  style={{ width: counts.total > 0 ? `${(counts.seen / counts.total) * 100}%` : '0%' }}
                />
              </div>
            </div>
          </footer>
        </>
      )}

      {/* Modal de estado especial */}
      {ausenteCard && (
        <AusenteModal
          plate={ausenteCard.plate}
          statusTypes={statusTypes}
          onClose={() => setAusenteCard(null)}
          onConfirm={handleAusente}
        />
      )}
    </div>
  );
}
