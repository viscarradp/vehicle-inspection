import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  CheckCircle2, ArrowRight, Building2, Loader2, TriangleAlert, RefreshCw, EyeOff,
} from 'lucide-react';

import { useAuth }    from '@/context/AuthContext';
import { issueApi, reportApi, branchApi, vehicleApi, inspectionApi, settingsApi } from '@/api/endpoints';
import { cn }         from '@/lib/utils';
import { shiftLabel } from '@/lib/shifts';
import type { GuardDashboard, SettingKey, SettingMeta } from '@/types';

// ─── Tipos locales ──────────────────────────────────────────────────────────

interface OpenIssue { id: string; severity: 'low' | 'medium' | 'high'; status: string; }
interface Branch { id: number; name: string; timezone?: string; }
interface UnseenVehicle { vehicleId: string; plate: string; lastSeenAt: string | null; hasOpenIssues: boolean; }

// ─── Widget: Turno actual (sucursal) ──────────────────────────────────────────

function ShiftSummaryWidget({ dash, loading }: { dash: GuardDashboard | null; loading: boolean }) {
  if (loading) {
    return (
      <div className="flex min-h-[120px] items-center justify-center rounded-xl border border-border bg-card p-6">
        <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
      </div>
    );
  }
  if (!dash) {
    return (
      <div className="flex min-h-[120px] flex-col justify-center rounded-xl border border-dashed border-border bg-card p-6 text-muted-foreground">
        <p className="font-semibold text-foreground">Sin contexto de turno</p>
        <p className="text-sm">Tu usuario no tiene una sucursal asignada.</p>
      </div>
    );
  }
  const { counts, shift } = dash;
  const pct = counts.total > 0 ? Math.round((counts.seen / counts.total) * 100) : 0;
  return (
    <div className="rounded-xl border border-emerald-200 bg-card p-6">
      <div className="mb-4 flex items-start justify-between gap-3">
        <div>
          <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">Turno actual</p>
          <p className="mt-1 text-xl font-bold">Turno {shiftLabel(shift)}</p>
          <p className="text-sm text-muted-foreground">{dash.localDate}</p>
        </div>
        {counts.unseen > 0 ? (
          <span className="shrink-0 rounded-full bg-amber-100 px-3 py-1 text-xs font-semibold text-amber-800">
            {counts.unseen} sin ver
          </span>
        ) : (
          <span className="shrink-0 rounded-full bg-emerald-100 px-3 py-1 text-xs font-semibold text-emerald-800">
            Flota al día
          </span>
        )}
      </div>
      <div className="mb-2 flex items-center justify-between text-sm">
        <span className="text-muted-foreground">{counts.seen} de {counts.total} vistos este turno</span>
        <span className="font-mono font-semibold tabular-nums">{pct}%</span>
      </div>
      <div className="h-2.5 overflow-hidden rounded-full bg-secondary">
        <div className="h-full rounded-full bg-emerald-500 transition-all" style={{ width: `${pct}%` }} />
      </div>
    </div>
  );
}

// ─── Widget: Monitor de no-vistos (control suave) ─────────────────────────────

function UnseenMonitor({ vehicles, loading }: { vehicles: UnseenVehicle[]; loading: boolean }) {
  return (
    <div className={cn('rounded-xl border bg-card', vehicles.length > 0 ? 'border-amber-200' : 'border-border')}>
      <div className="flex items-center gap-2 border-b border-border px-5 py-3">
        <EyeOff className="h-4 w-4 text-muted-foreground" />
        <p className="text-sm font-semibold uppercase tracking-wider text-muted-foreground">
          No vistos recientemente
        </p>
        {!loading && (
          <span className={cn('ml-auto rounded-full px-2.5 py-0.5 text-xs font-semibold',
            vehicles.length > 0 ? 'bg-amber-100 text-amber-800' : 'bg-emerald-100 text-emerald-800')}>
            {vehicles.length}
          </span>
        )}
      </div>
      {loading ? (
        <div className="flex items-center justify-center py-8"><Loader2 className="h-5 w-5 animate-spin text-muted-foreground" /></div>
      ) : vehicles.length === 0 ? (
        <div className="flex items-center gap-2 px-5 py-6 text-sm text-emerald-700">
          <CheckCircle2 className="h-4 w-4" /> Todos los vehículos activos han sido inspeccionados a tiempo.
        </div>
      ) : (
        <ul className="divide-y divide-border">
          {vehicles.map(v => (
            <li key={v.vehicleId} className="flex items-center gap-3 px-5 py-2.5">
              <span className="font-mono text-base font-bold">{v.plate}</span>
              {v.hasOpenIssues && <TriangleAlert className="h-4 w-4 text-red-500" />}
              <span className="ml-auto text-xs text-muted-foreground">
                {v.lastSeenAt ? `visto ${new Date(v.lastSeenAt).toLocaleString('es-GT')}` : 'nunca inspeccionado'}
              </span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

// ─── Widget: Daños abiertos ───────────────────────────────────────────────────

function IssuesWidget({ issues, loading }: { issues: OpenIssue[]; loading: boolean }) {
  const navigate = useNavigate();
  const high = issues.filter(i => i.severity === 'high').length;
  const count = issues.length;
  return (
    <div className={cn('flex flex-col rounded-xl border bg-card p-5', count > 0 ? 'border-red-200' : 'border-border')}>
      <div className="mb-1 text-xs font-semibold uppercase tracking-wider text-muted-foreground">Daños abiertos</div>
      {loading ? (
        <div className="flex flex-1 items-center justify-center py-4"><Loader2 className="h-5 w-5 animate-spin text-muted-foreground" /></div>
      ) : (
        <>
          <div className={cn('mb-2 text-4xl font-bold tabular-nums', count === 0 ? 'text-muted-foreground' : high > 0 ? 'text-red-600' : 'text-amber-600')}>{count}</div>
          <div className="mb-4 flex flex-col gap-1 text-sm text-muted-foreground">
            {high > 0 && <span className="font-medium text-red-600">· {high} grave{high > 1 ? 's' : ''}</span>}
            {count === 0 && <span className="text-emerald-600">✓ Sin problemas abiertos</span>}
          </div>
          <button onClick={() => navigate('/ops/issues')} className="mt-auto flex items-center gap-1.5 text-sm font-medium text-primary hover:underline">
            {count > 0 ? 'Gestionar' : 'Ver historial'}<ArrowRight className="h-3.5 w-3.5" />
          </button>
        </>
      )}
    </div>
  );
}

// ─── Widget: Sin revisión +N días ─────────────────────────────────────────────

function NoReviewWidget({ count, days, loading }: { count: number; days: number; loading: boolean }) {
  const navigate = useNavigate();
  return (
    <div className={cn('flex flex-col rounded-xl border bg-card p-5', count > 0 ? 'border-amber-200' : 'border-border')}>
      <div className="mb-1 text-xs font-semibold uppercase tracking-wider text-muted-foreground">Sin revisión +{days} días</div>
      {loading ? (
        <div className="flex flex-1 items-center justify-center py-4"><Loader2 className="h-5 w-5 animate-spin text-muted-foreground" /></div>
      ) : (
        <>
          <div className={cn('mb-2 text-4xl font-bold tabular-nums', count === 0 ? 'text-muted-foreground' : 'text-amber-600')}>{count}</div>
          <div className="mb-4 text-sm text-muted-foreground">
            {count === 0 ? <span className="text-emerald-600">✓ Flota al día</span> : <span>{count === 1 ? 'vehículo sin' : 'vehículos sin'} inspección reciente</span>}
          </div>
          <button onClick={() => navigate('/ops/fleet')} className="mt-auto flex items-center gap-1.5 text-sm font-medium text-primary hover:underline">
            Ver flota<ArrowRight className="h-3.5 w-3.5" />
          </button>
        </>
      )}
    </div>
  );
}

// ─── Widget: Lista de sucursales ──────────────────────────────────────────────

function BranchListWidget({ branches, loading }: { branches: Branch[]; loading: boolean }) {
  return (
    <div className="rounded-xl border border-border bg-card">
      <div className="border-b border-border px-5 py-3">
        <p className="text-sm font-semibold uppercase tracking-wider text-muted-foreground">Sucursales en tu alcance</p>
      </div>
      {loading ? (
        <div className="flex items-center justify-center py-8"><Loader2 className="h-5 w-5 animate-spin text-muted-foreground" /></div>
      ) : branches.length === 0 ? (
        <div className="px-5 py-6 text-sm text-muted-foreground">Sin sucursales configuradas.</div>
      ) : (
        <ul className="divide-y divide-border">
          {branches.map(b => (
            <li key={b.id} className="flex items-center gap-3 px-5 py-3">
              <Building2 className="h-4 w-4 shrink-0 text-muted-foreground" />
              <span className="flex-1 text-sm font-medium">{b.name}</span>
              {b.timezone && <span className="text-xs text-muted-foreground">{b.timezone}</span>}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

// ─── OpsCenter ────────────────────────────────────────────────────────────────

export function OpsCenter() {
  const { user, isCountryScope } = useAuth();

  const [dashLoading, setDashLoading]     = useState(true);
  const [issuesLoading, setIssuesLoading] = useState(true);
  const [noReviewLoading, setNoReviewLoading] = useState(true);
  const [unseenLoading, setUnseenLoading] = useState(true);
  const [branchesLoading, setBranchesLoading] = useState(true);

  const [dash, setDash]               = useState<GuardDashboard | null>(null);
  const [openIssues, setOpenIssues]   = useState<OpenIssue[]>([]);
  const [noReviewCount, setNoReviewCount] = useState(0);
  const [noReviewDays, setNoReviewDays]   = useState(3);
  const [unseen, setUnseen]           = useState<UnseenVehicle[]>([]);
  const [branches, setBranches]       = useState<Branch[]>([]);

  useEffect(() => {
    // Resumen del turno actual (solo roles con sucursal)
    if (!isCountryScope) {
      inspectionApi.dashboard()
        .then(r => setDash(r.data.data as GuardDashboard))
        .catch(() => setDash(null))
        .finally(() => setDashLoading(false));
    } else {
      setDashLoading(false);
    }

    issueApi.list({ status: 'open' })
      .then(r => setOpenIssues((r.data.data as OpenIssue[]) ?? []))
      .catch(() => setOpenIssues([]))
      .finally(() => setIssuesLoading(false));

    // Obtener el umbral de "días sin revisión" del setting de la sucursal,
    // luego usarlo para la petición de reportes y para la etiqueta del widget.
    settingsApi.get()
      .then(res => {
        const raw = res.data.data as Record<SettingKey, SettingMeta>;
        const days = (raw.no_review_days_threshold?.value as number) ?? 3;
        setNoReviewDays(days);
        return reportApi.noReview(days);
      })
      .then(r => setNoReviewCount(((r.data.data as unknown[]) ?? []).length))
      .catch(() => setNoReviewCount(0))
      .finally(() => setNoReviewLoading(false));

    vehicleApi.unseen()
      .then(r => setUnseen(((r.data.data as { vehicles: UnseenVehicle[] })?.vehicles) ?? []))
      .catch(() => setUnseen([]))
      .finally(() => setUnseenLoading(false));

    if (isCountryScope) {
      branchApi.list()
        .then(r => setBranches((r.data.data as Branch[]) ?? []))
        .catch(() => setBranches([]))
        .finally(() => setBranchesLoading(false));
    } else {
      setBranchesLoading(false);
    }
  }, [isCountryScope]);

  const today = new Date().toLocaleDateString('es-GT', { weekday: 'long', day: '2-digit', month: 'long', year: 'numeric' });
  const pageTitle = isCountryScope
    ? user?.role === 'admin_global' ? 'Vista Global' : 'Vista País'
    : 'Centro de Operaciones';
  const pageSubtitle = isCountryScope ? `Monitoreo de todas las sucursales · ${today}` : today.charAt(0).toUpperCase() + today.slice(1);

  return (
    <div className="flex flex-1 flex-col overflow-hidden">
      <div className="flex flex-shrink-0 items-center justify-between border-b border-border bg-card px-6 py-4">
        <div>
          <h1 className="text-xl font-bold">{pageTitle}</h1>
          <p className="mt-0.5 text-sm text-muted-foreground capitalize">{pageSubtitle}</p>
        </div>
        <button onClick={() => window.location.reload()} className="flex items-center gap-1.5 rounded-lg border border-border px-3 py-2 text-sm text-muted-foreground hover:bg-muted">
          <RefreshCw className="h-4 w-4" /> Actualizar
        </button>
      </div>

      <div className="flex-1 overflow-auto px-6 py-6">
        <div className="mx-auto max-w-5xl space-y-6">
          {!isCountryScope ? (
            <>
              <ShiftSummaryWidget dash={dash} loading={dashLoading} />
              <div className="grid grid-cols-2 gap-4">
                <IssuesWidget issues={openIssues} loading={issuesLoading} />
                <NoReviewWidget count={noReviewCount} days={noReviewDays} loading={noReviewLoading} />
              </div>
            </>
          ) : (
            <>
              <div className="grid grid-cols-2 gap-4 sm:grid-cols-3">
                <IssuesWidget issues={openIssues} loading={issuesLoading} />
                <NoReviewWidget count={noReviewCount} days={noReviewDays} loading={noReviewLoading} />
                <div className="flex flex-col rounded-xl border border-border bg-card p-5">
                  <div className="mb-1 text-xs font-semibold uppercase tracking-wider text-muted-foreground">Sucursales</div>
                  {branchesLoading ? <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" /> : (
                    <>
                      <div className="text-4xl font-bold tabular-nums">{branches.length}</div>
                      <div className="mt-2 text-sm text-muted-foreground">en tu alcance</div>
                    </>
                  )}
                </div>
              </div>
              <BranchListWidget branches={branches} loading={branchesLoading} />
            </>
          )}

          {/* Monitor suave de completitud — control que reemplaza el gate de envío */}
          <UnseenMonitor vehicles={unseen} loading={unseenLoading} />
        </div>
      </div>
    </div>
  );
}
