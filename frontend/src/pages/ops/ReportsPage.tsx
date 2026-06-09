import { useEffect, useState, useCallback } from 'react';
import { Loader2, Download, Pencil } from 'lucide-react';
import toast from 'react-hot-toast';

import { useAuth }       from '@/context/AuthContext';
import { reportApi }     from '@/api/endpoints';
import { PageHeader }    from '@/components/layouts/OpsShell';
import { StatusBadge }   from '@/components/StatusBadge';
import { InspectionForm } from '@/components/InspectionForm';
import { shiftLabel }    from '@/lib/shifts';
import { cn }            from '@/lib/utils';
import type { VehicleDashboardCard, Shift, InspectionStatus } from '@/types';

interface ReportInspection {
  id: string;
  vehicleId: string;
  plate: string;
  shift: Shift;
  guardName: string;
  status: InspectionStatus;
  returnStatus: string;
  finalDriverNameManual?: string;
  mileage?: number;
  fuelLevel?: string;
  cleanlinessStatus?: string;
  generalObservation?: string;
  hasNewIssue?: boolean;
  createdAt: string;
}

interface DailyReport {
  date: string;
  shift: Shift | null;
  guardNames: string[];
  inspections: ReportInspection[];
  counts: { total: number; reviewed: number; issues: number; notReturned: number; other: number };
}

const FUEL_LABEL: Record<string, string> = {
  empty: 'Vacío', quarter: '1/4', half: '1/2', three_quarters: '3/4', full: 'Lleno',
};
const SHIFT_PILL: Record<string, string> = {
  morning:   'bg-amber-100 text-amber-800 border-amber-300',
  afternoon: 'bg-sky-100 text-sky-800 border-sky-300',
  night:     'bg-violet-100 text-violet-800 border-violet-300',
};
const SHIFT_OPTS: { v: '' | Shift; label: string }[] = [
  { v: '',          label: 'Todos los turnos' },
  { v: 'morning',   label: 'Mañana' },
  { v: 'afternoon', label: 'Tarde' },
  { v: 'night',     label: 'Noche' },
];

function todayISO(): string {
  return new Date().toLocaleDateString('en-CA'); // YYYY-MM-DD local
}

/** Sintetiza un card mínimo para reabrir una inspección en el formulario. */
function cardFromInspection(insp: ReportInspection): VehicleDashboardCard {
  return {
    vehicleId: insp.vehicleId,
    plate: insp.plate,
    vehicleType: '', brand: '', model: '',
    currentStatus: 'active',
    hasOpenIssues: !!insp.hasNewIssue,
    todayRecord: { kind: 'received', inspectionId: insp.id, inspectionStatus: insp.status },
    noReviewAlert: false,
    lastMileage: 0,
  };
}

export function ReportsPage() {
  const { canModifyAfterSubmit } = useAuth();

  const [date, setDate]           = useState(todayISO());
  const [shift, setShift]         = useState<'' | Shift>('');
  const [report, setReport]       = useState<DailyReport | null>(null);
  const [loading, setLoading]     = useState(true);
  const [exporting, setExporting] = useState(false);
  const [editing, setEditing]     = useState<ReportInspection | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const r = await reportApi.daily(date, shift || undefined);
      setReport(r.data.data as DailyReport);
    } catch {
      toast.error('No se pudo cargar el reporte.');
      setReport(null);
    } finally {
      setLoading(false);
    }
  }, [date, shift]);

  useEffect(() => { load(); }, [load]);

  const handleExport = async () => {
    setExporting(true);
    try {
      const res = await reportApi.exportDaily(date, shift || undefined);
      const url = URL.createObjectURL(new Blob([res.data]));
      const a = document.createElement('a');
      a.href = url;
      a.download = `reporte_${date}${shift ? '_' + shift : ''}.xlsx`;
      a.click();
      URL.revokeObjectURL(url);
    } catch {
      toast.error('No se pudo exportar el reporte.');
    } finally {
      setExporting(false);
    }
  };

  // ── Edición de una inspección (supervisor) ──────────────────────────────────
  if (editing) {
    return (
      <InspectionForm
        card={cardFromInspection(editing)}
        loadFromId={editing.id}
        editById
        isSealed
        canModify={canModifyAfterSubmit}
        onSaved={() => { setEditing(null); load(); }}
        onBack={() => setEditing(null)}
      />
    );
  }

  const counts = report?.counts;
  const inspections = report?.inspections ?? [];

  return (
    <div className="flex flex-1 flex-col overflow-hidden">
      <PageHeader
        title="Reportes por turno"
        subtitle="Stream de inspecciones por fecha y turno"
        action={
          <button
            disabled={exporting || inspections.length === 0}
            onClick={handleExport}
            className="flex items-center gap-1.5 rounded-lg border border-border px-3 py-2 text-sm font-medium text-muted-foreground hover:bg-muted disabled:opacity-40"
          >
            {exporting ? <Loader2 className="h-4 w-4 animate-spin" /> : <Download className="h-4 w-4" />}
            Exportar .xlsx
          </button>
        }
      />

      {/* Controles de fecha/turno */}
      <div className="flex flex-shrink-0 flex-wrap items-center gap-3 border-b border-border bg-muted/30 px-6 py-3">
        <input
          type="date"
          value={date}
          onChange={e => setDate(e.target.value)}
          className="input-box"
        />
        <div className="flex gap-1.5">
          {SHIFT_OPTS.map(o => (
            <button
              key={o.v}
              onClick={() => setShift(o.v)}
              className={cn(
                'rounded-lg border px-3 py-1.5 text-sm font-medium transition-colors',
                shift === o.v ? 'border-primary bg-primary/10 text-primary' : 'border-border text-muted-foreground hover:bg-muted',
              )}
            >
              {o.label}
            </button>
          ))}
        </div>
        {counts && (
          <div className="ml-auto flex items-center gap-3 text-sm text-muted-foreground">
            <span><b className="text-foreground tabular-nums">{counts.total}</b> insp.</span>
            {counts.issues > 0 && <span className="text-red-600 font-medium">{counts.issues} con daño</span>}
            {counts.notReturned > 0 && <span className="text-orange-600">{counts.notReturned} no retornó</span>}
          </div>
        )}
      </div>

      <div className="flex-1 overflow-auto px-6 py-5">
        <div className="mx-auto max-w-3xl">
          {loading ? (
            <div className="flex justify-center py-16"><Loader2 className="h-7 w-7 animate-spin text-muted-foreground" /></div>
          ) : inspections.length === 0 ? (
            <div className="py-12 text-center text-muted-foreground">Sin inspecciones para esta fecha/turno.</div>
          ) : (
            <div className="flex flex-col gap-3">
              {inspections.map(insp => (
                <div key={insp.id} className="flex items-start gap-4 rounded-xl border border-border bg-card p-4">
                  <div className="w-28 flex-shrink-0">
                    <div className="font-mono text-xl font-bold">{insp.plate}</div>
                    <StatusBadge status={insp.status} className="mt-1 text-xs" />
                  </div>
                  <div className="flex-1 grid grid-cols-2 gap-x-4 gap-y-1 text-sm text-muted-foreground">
                    <span className={cn('inline-flex w-fit rounded border px-1.5 text-xs font-semibold', SHIFT_PILL[insp.shift] ?? '')}>
                      {shiftLabel(insp.shift)}
                    </span>
                    <span className="truncate">{insp.guardName}</span>
                    {insp.mileage != null && <span>Km: <b className="text-foreground">{insp.mileage.toLocaleString('es-GT')}</b></span>}
                    {insp.fuelLevel && <span>Comb: <b className="text-foreground">{FUEL_LABEL[insp.fuelLevel] ?? insp.fuelLevel}</b></span>}
                    {insp.finalDriverNameManual && <span className="col-span-2">Conductor: <b className="text-foreground">{insp.finalDriverNameManual}</b></span>}
                  </div>
                  {insp.generalObservation && (
                    <p className="max-w-xs text-sm italic text-muted-foreground">{insp.generalObservation}</p>
                  )}
                  {canModifyAfterSubmit && (
                    <button
                      onClick={() => setEditing(insp)}
                      className="ml-auto shrink-0 rounded-lg border border-border p-2 text-muted-foreground hover:bg-muted"
                      title="Corregir (requiere justificación)"
                    >
                      <Pencil className="h-4 w-4" />
                    </button>
                  )}
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
