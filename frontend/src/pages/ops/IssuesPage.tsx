import { useEffect, useState, useCallback } from 'react';
import toast from 'react-hot-toast';
import { Loader2, CheckCircle2, Clock } from 'lucide-react';

import { issueApi }    from '@/api/endpoints';
import { PageHeader }  from '@/components/layouts/OpsShell';
import { cn }          from '@/lib/utils';

// ─── Tipos ────────────────────────────────────────────────────────────────────

interface Issue {
  id: string;
  plate: string;
  vehicleId: string;
  issueType: string;
  description: string;
  severity: 'low' | 'medium' | 'high';
  status: 'open' | 'in_process' | 'resolved' | 'dismissed';
  detectedBy: string;
  detectedAt: string;
  maintenanceAction?: string;
}

// ─── Mapas de presentación ────────────────────────────────────────────────────

const SEVERITY_STYLE: Record<string, { badge: string; label: string }> = {
  high:   { badge: 'bg-red-100 text-red-800 border-red-300',     label: 'Grave' },
  medium: { badge: 'bg-amber-100 text-amber-800 border-amber-300', label: 'Medio' },
  low:    { badge: 'bg-slate-100 text-slate-700 border-slate-300', label: 'Leve' },
};

const STATUS_STYLE: Record<string, { badge: string; label: string }> = {
  open:      { badge: 'bg-red-50 text-red-700 border-red-200',       label: 'Abierto' },
  in_process:{ badge: 'bg-amber-50 text-amber-700 border-amber-200', label: 'En proceso' },
  resolved:  { badge: 'bg-emerald-50 text-emerald-700 border-emerald-200', label: 'Resuelto' },
  dismissed: { badge: 'bg-slate-50 text-slate-500 border-slate-200', label: 'Desestimado' },
};

const ISSUE_TYPE_LABEL: Record<string, string> = {
  damage:                 'Daño',
  missing_tool:           'Herramienta faltante',
  cleanliness_problem:    'Problema de limpieza',
  documentation_problem:  'Problema de documentación',
  other:                  'Otro',
};

function formatDate(iso: string) {
  return new Date(iso).toLocaleDateString('es-GT', {
    day: '2-digit', month: 'short', year: 'numeric',
  });
}

// ─── Chip de severidad / estado ───────────────────────────────────────────────

function Chip({ text, style }: { text: string; style: string }) {
  return (
    <span className={cn('inline-flex items-center rounded-full border px-2.5 py-0.5 text-xs font-semibold', style)}>
      {text}
    </span>
  );
}

// ─── Fila de issue ────────────────────────────────────────────────────────────

function IssueRow({ issue, onUpdated }: { issue: Issue; onUpdated: () => void }) {
  const [expanded, setExpanded] = useState(false);
  const [action,   setAction]   = useState('');
  const [obs,      setObs]      = useState('');
  const [busy,     setBusy]     = useState(false);

  const sev = SEVERITY_STYLE[issue.severity] ?? SEVERITY_STYLE.low;
  const sta = STATUS_STYLE[issue.status] ?? STATUS_STYLE.open;
  const isActive = issue.status === 'open' || issue.status === 'in_process';

  const handleMarkInProcess = async () => {
    setBusy(true);
    try {
      await issueApi.updateStatus(issue.id, 'in_process');
      toast.success('Marcado como en proceso.');
      onUpdated();
    } catch { toast.error('Error al actualizar.'); }
    finally { setBusy(false); }
  };

  const handleClose = async () => {
    if (!action.trim()) { toast.error('Ingresa la acción tomada.'); return; }
    setBusy(true);
    try {
      await issueApi.close(issue.id, action, obs || undefined);
      toast.success('Problema cerrado correctamente.');
      setExpanded(false); setAction(''); setObs('');
      onUpdated();
    } catch { toast.error('Error al cerrar el problema.'); }
    finally { setBusy(false); }
  };

  return (
    <div className={cn(
      'rounded-xl border bg-card transition-shadow',
      issue.severity === 'high' && issue.status === 'open' ? 'border-red-200' : 'border-border',
    )}>
      {/* Cabecera de la tarjeta */}
      <div className="flex items-start gap-4 p-5">
        <div className="flex-1 min-w-0">
          <div className="flex flex-wrap items-center gap-2 mb-2">
            <span className="font-mono text-lg font-bold">{issue.plate}</span>
            <Chip text={ISSUE_TYPE_LABEL[issue.issueType] ?? issue.issueType} style={sev.badge} />
            <Chip text={sev.label} style={sev.badge} />
            <Chip text={sta.label} style={sta.badge} />
          </div>
          <p className="text-sm text-foreground mb-1">{issue.description}</p>
          <p className="text-xs text-muted-foreground">
            Detectado por <span className="font-medium">{issue.detectedBy}</span> · {formatDate(issue.detectedAt)}
          </p>
        </div>
      </div>

      {/* Acciones */}
      {isActive && (
        <div className="border-t border-border px-5 py-3">
          {!expanded ? (
            <div className="flex flex-wrap gap-2">
              {issue.status === 'open' && (
                <button
                  disabled={busy}
                  onClick={handleMarkInProcess}
                  className="flex items-center gap-1.5 rounded-lg border border-border px-3 py-1.5 text-sm font-medium text-muted-foreground hover:bg-muted disabled:opacity-50"
                >
                  <Clock className="h-3.5 w-3.5" />
                  Marcar en proceso
                </button>
              )}
              <button
                onClick={() => setExpanded(true)}
                className="flex items-center gap-1.5 rounded-lg bg-primary px-3 py-1.5 text-sm font-medium text-primary-foreground hover:bg-primary/90"
              >
                <CheckCircle2 className="h-3.5 w-3.5" />
                Cerrar problema →
              </button>
            </div>
          ) : (
            <div className="flex flex-col gap-3">
              <div>
                <label className="mb-1.5 block text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                  Acción tomada <span className="text-red-500">*</span>
                </label>
                <input
                  className="w-full rounded-lg border border-border bg-background px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary"
                  placeholder="Describir qué se hizo…"
                  value={action}
                  onChange={e => setAction(e.target.value)}
                />
              </div>
              <div>
                <label className="mb-1.5 block text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                  Observación adicional
                </label>
                <input
                  className="w-full rounded-lg border border-border bg-background px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary"
                  placeholder="Opcional…"
                  value={obs}
                  onChange={e => setObs(e.target.value)}
                />
              </div>
              <div className="flex gap-2">
                <button
                  onClick={() => { setExpanded(false); setAction(''); setObs(''); }}
                  className="rounded-lg border border-border px-4 py-2 text-sm font-medium hover:bg-muted"
                >
                  Cancelar
                </button>
                <button
                  disabled={busy}
                  onClick={handleClose}
                  className="flex items-center gap-1.5 rounded-lg bg-primary px-4 py-2 text-sm font-semibold text-primary-foreground hover:bg-primary/90 disabled:opacity-50"
                >
                  {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <CheckCircle2 className="h-4 w-4" />}
                  Confirmar cierre
                </button>
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

// ─── IssuesPage ───────────────────────────────────────────────────────────────

type FilterMode = 'open' | 'all';

export function IssuesPage() {
  const [issues,  setIssues]  = useState<Issue[]>([]);
  const [loading, setLoading] = useState(true);
  const [filter,  setFilter]  = useState<FilterMode>('open');

  const load = useCallback(() => {
    setLoading(true);
    const params = filter === 'open' ? { status: 'open' } : undefined;
    issueApi.list(params)
      .then(r => setIssues((r.data.data as Issue[]) ?? []))
      .catch(() => toast.error('No se pudieron cargar los problemas.'))
      .finally(() => setLoading(false));
  }, [filter]);

  useEffect(() => { load(); }, [load]);

  const openCount = issues.filter(i => i.status === 'open' || i.status === 'in_process').length;
  const highCount = issues.filter(i => i.severity === 'high' && (i.status === 'open' || i.status === 'in_process')).length;

  return (
    <div className="flex flex-1 flex-col overflow-hidden">
      <PageHeader
        title="Daños abiertos"
        subtitle={
          openCount > 0
            ? `${openCount} problema${openCount !== 1 ? 's' : ''} activo${openCount !== 1 ? 's' : ''}${highCount > 0 ? ` · ${highCount} grave${highCount !== 1 ? 's' : ''}` : ''}`
            : 'Sin problemas activos'
        }
      />

      <div className="flex-1 overflow-auto px-6 py-5">
        <div className="mx-auto max-w-3xl space-y-4">
          {/* Filtro */}
          <div className="flex gap-2">
            {(['open', 'all'] as FilterMode[]).map(f => (
              <button
                key={f}
                onClick={() => setFilter(f)}
                className={cn(
                  'rounded-lg border px-4 py-2 text-sm font-medium transition-colors',
                  filter === f
                    ? 'border-primary bg-primary text-primary-foreground'
                    : 'border-border bg-card text-muted-foreground hover:bg-muted',
                )}
              >
                {f === 'open' ? 'Activos' : 'Todos'}
              </button>
            ))}
          </div>

          {/* Lista */}
          {loading ? (
            <div className="flex justify-center py-16">
              <Loader2 className="h-7 w-7 animate-spin text-muted-foreground" />
            </div>
          ) : issues.length === 0 ? (
            <div className="flex flex-col items-center gap-3 py-16 text-muted-foreground">
              <CheckCircle2 className="h-10 w-10 text-emerald-500" />
              <p className="text-base font-medium">
                {filter === 'open' ? 'Sin problemas abiertos. ✓' : 'Sin registros.'}
              </p>
            </div>
          ) : (
            <div className="flex flex-col gap-3">
              {issues.map(issue => (
                <IssueRow key={issue.id} issue={issue} onUpdated={load} />
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
