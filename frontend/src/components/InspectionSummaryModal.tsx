import { Send, X, Loader2, Car, Gauge, Users, Fuel } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';

// ─── Resumen tipado que alimenta el modal ──────────────────────────────────────
// El Dashboard lo arma desde la inspección borrador (inspectionApi.get) + la card.
export interface InspectionSummary {
  plate:                 string;
  vehicleType?:          string;
  brand?:                string;
  model?:                string;
  localDate?:            string;
  shift?:                string;
  mileage?:              number;
  previousMileage?:      number;
  mileageDifference?:    number;
  guardName?:            string;   // quién recibe (garita)
  driverName?:           string;   // quién entrega (conductor)
  exteriorGeneralStatus?: string;  // ok | observed | damaged
  interiorGeneralStatus?: string;  // ok | observed | damaged
  toolsGeneralStatus?:    string;  // ok | missing | damaged
  fuelLevel?:            string;   // empty | quarter | half | three_quarters | full
  cleanlinessStatus?:    string;   // clean | acceptable | dirty | very_dirty
  generalObservation?:   string;
}

// ─── Mapeos de etiquetas / estilos ──────────────────────────────────────────────

const SHIFT_LABEL: Record<string, string> = {
  morning: 'Mañana', afternoon: 'Tarde', night: 'Noche',
};
const FUEL_PCT: Record<string, number> = {
  empty: 0, quarter: 25, half: 50, three_quarters: 75, full: 100,
};
const FUEL_LABEL: Record<string, string> = {
  empty: 'Vacío', quarter: '1/4', half: '1/2', three_quarters: '3/4', full: 'Lleno',
};
const CLEAN_LABEL: Record<string, string> = {
  clean: 'Limpio', acceptable: 'Aceptable', dirty: 'Sucio', very_dirty: 'Muy sucio',
};

function areaMeta(v?: string): { label: string; cls: string } {
  switch (v) {
    case 'ok':       return { label: 'Bueno',           cls: 'border-emerald-300 bg-emerald-100 text-emerald-700' };
    case 'observed': return { label: 'Con observación', cls: 'border-amber-300 bg-amber-100 text-amber-700' };
    case 'damaged':  return { label: 'Daño',            cls: 'border-red-300 bg-red-100 text-red-700' };
    default:         return { label: '—',               cls: 'border-border bg-muted text-muted-foreground' };
  }
}
function toolsMeta(v?: string): { label: string; cls: string } {
  switch (v) {
    case 'ok':       return { label: 'Completas', cls: 'border-emerald-300 bg-emerald-100 text-emerald-700' };
    case 'missing':  return { label: 'Faltante',  cls: 'border-red-300 bg-red-100 text-red-700' };
    case 'damaged':  return { label: 'Daño',      cls: 'border-amber-300 bg-amber-100 text-amber-700' };
    default:         return { label: '—',         cls: 'border-border bg-muted text-muted-foreground' };
  }
}

// ─── Subcomponentes ─────────────────────────────────────────────────────────────

function Field({ label, value, mono }: { label: string; value: string; mono?: boolean }) {
  return (
    <div>
      <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">{label}</p>
      <p className={cn('mt-0.5 text-base text-foreground', mono && 'font-mono')}>{value || '—'}</p>
    </div>
  );
}

function ChecklistColumn({ title, label, cls }: { title: string; label: string; cls: string }) {
  return (
    <div className="flex flex-col items-center gap-3 rounded-lg border border-border bg-muted/30 p-4 text-center">
      <p className="text-sm font-semibold text-foreground">{title}</p>
      <span className={cn('rounded-full border px-4 py-1.5 text-sm font-semibold', cls)}>
        {label}
      </span>
    </div>
  );
}

function SectionTitle({ children }: { children: React.ReactNode }) {
  return (
    <p className="mb-3 text-sm font-semibold uppercase tracking-wide text-muted-foreground">
      {children}
    </p>
  );
}

// ─── Modal ──────────────────────────────────────────────────────────────────────

interface Props {
  summary: InspectionSummary;
  sending: boolean;
  onConfirm: () => void;
  onClose: () => void;
  /** Solo lectura: el reporte ya fue enviado. Oculta el botón de confirmar. */
  readOnly?: boolean;
}

export function InspectionSummaryModal({ summary, sending, onConfirm, onClose, readOnly }: Props) {
  const ext   = areaMeta(summary.exteriorGeneralStatus);
  const int   = areaMeta(summary.interiorGeneralStatus);
  const tools = toolsMeta(summary.toolsGeneralStatus);
  const fuelPct = summary.fuelLevel ? FUEL_PCT[summary.fuelLevel] ?? 0 : 0;

  const mileageStr = summary.mileage != null
    ? `${summary.mileage.toLocaleString('es-GT')} km`
    : '—';
  const diffStr = summary.mileageDifference != null
    ? `${summary.mileageDifference >= 0 ? '+' : ''}${summary.mileageDifference.toLocaleString('es-GT')} km`
    : '';
  const dateStr = [
    summary.localDate,
    summary.shift ? (SHIFT_LABEL[summary.shift] ?? summary.shift) : '',
  ].filter(Boolean).join(' · ');

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4"
      onClick={onClose}
    >
      <div
        className="flex max-h-[92dvh] w-full max-w-3xl flex-col overflow-hidden rounded-xl border border-border bg-card shadow-xl"
        onClick={e => e.stopPropagation()}
      >
        {/* ── Header ── */}
        <div className="flex items-center justify-between gap-4 border-b border-border px-6 py-4">
          <div>
            <h3 className="text-xl font-semibold">Resumen de inspección</h3>
            <p className="mt-0.5 text-sm text-muted-foreground">
              {readOnly
                ? 'Reporte enviado — solo lectura.'
                : 'Revisa la información antes de enviar el reporte.'}
            </p>
          </div>
          <button
            onClick={onClose}
            className="rounded-md p-1.5 text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
            aria-label="Cerrar"
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        {/* ── Cuerpo ── */}
        <div className="flex flex-col gap-6 overflow-auto px-6 py-5">

          {/* 1 · Información general y recepción */}
          <section>
            <SectionTitle>Información general y recepción</SectionTitle>
            <div className="grid grid-cols-1 gap-4 rounded-lg border border-border bg-muted/20 p-4 sm:grid-cols-3">
              {/* Bloque vehículo */}
              <div className="flex flex-col gap-2">
                <div className="flex items-center gap-2 text-muted-foreground">
                  <Car className="h-4 w-4" />
                  <span className="text-xs font-medium uppercase tracking-wide">Vehículo</span>
                </div>
                <p className="font-mono text-2xl font-bold leading-none tracking-wider">{summary.plate}</p>
                <p className="text-sm text-foreground/80">
                  {[summary.vehicleType, summary.brand, summary.model].filter(Boolean).join(' ') || '—'}
                </p>
              </div>
              {/* Bloque métricas */}
              <div className="flex flex-col gap-2">
                <div className="flex items-center gap-2 text-muted-foreground">
                  <Gauge className="h-4 w-4" />
                  <span className="text-xs font-medium uppercase tracking-wide">Métricas</span>
                </div>
                <p className="font-mono text-xl font-bold leading-none">
                  {mileageStr}
                  {diffStr && <span className="ml-2 text-sm font-normal text-muted-foreground">({diffStr})</span>}
                </p>
                <p className="text-sm text-muted-foreground">{dateStr || '—'}</p>
              </div>
              {/* Bloque responsables */}
              <div className="flex flex-col gap-2">
                <div className="flex items-center gap-2 text-muted-foreground">
                  <Users className="h-4 w-4" />
                  <span className="text-xs font-medium uppercase tracking-wide">Responsables</span>
                </div>
                <Field label="Entrega" value={summary.driverName ?? '—'} />
                <Field label="Recibe"  value={summary.guardName ?? '—'} />
              </div>
            </div>
          </section>

          {/* 2 · Control de condiciones (checklists) */}
          <section>
            <SectionTitle>Control de condiciones</SectionTitle>
            <div className="grid grid-cols-3 gap-3">
              <ChecklistColumn title="Exteriores"  label={ext.label}   cls={ext.cls} />
              <ChecklistColumn title="Interiores"  label={int.label}   cls={int.cls} />
              <ChecklistColumn title="Accesorios"  label={tools.label} cls={tools.cls} />
            </div>
          </section>

          {/* 3 · Estado visual y combustible */}
          <section>
            <SectionTitle>Estado visual y combustible</SectionTitle>
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              {/* Izquierda: estado visual / limpieza */}
              <div className="rounded-lg border border-border bg-muted/20 p-4">
                <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Estado visual</p>
                <p className="mt-1 text-base font-medium">
                  Limpieza: {summary.cleanlinessStatus ? (CLEAN_LABEL[summary.cleanlinessStatus] ?? summary.cleanlinessStatus) : '—'}
                </p>
                <div className="mt-3 flex flex-wrap gap-2">
                  <span className={cn('rounded-full border px-3 py-1 text-xs font-semibold', ext.cls)}>Ext: {ext.label}</span>
                  <span className={cn('rounded-full border px-3 py-1 text-xs font-semibold', int.cls)}>Int: {int.label}</span>
                </div>
              </div>
              {/* Derecha: combustible */}
              <div className="rounded-lg border border-border bg-muted/20 p-4">
                <div className="flex items-center gap-2 text-muted-foreground">
                  <Fuel className="h-4 w-4" />
                  <span className="text-xs font-medium uppercase tracking-wide">Combustible</span>
                </div>
                <p className="mt-1 text-base font-semibold">
                  {summary.fuelLevel ? (FUEL_LABEL[summary.fuelLevel] ?? summary.fuelLevel) : '—'}
                </p>
                <div className="mt-3 h-3 overflow-hidden rounded-full bg-secondary">
                  <div
                    className="h-full rounded-full bg-primary transition-all"
                    style={{ width: `${fuelPct}%` }}
                  />
                </div>
              </div>
            </div>
          </section>

          {/* 4 · Observaciones */}
          <section>
            <SectionTitle>Observaciones</SectionTitle>
            <div className="rounded-lg border border-border bg-muted/20 p-4">
              <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Notas generales</p>
              <p className="mt-1 whitespace-pre-line text-base leading-relaxed text-foreground">
                {summary.generalObservation?.trim() || 'Sin observaciones.'}
              </p>
            </div>
          </section>
        </div>

        {/* ── Footer ── */}
        <div className="flex items-center justify-end gap-3 border-t border-border bg-muted/30 px-6 py-4">
          {readOnly ? (
            <Button size="touch" className="text-base" onClick={onClose}>
              Cerrar
            </Button>
          ) : (
            <>
              <Button variant="outline" size="touch" className="text-base" onClick={onClose} disabled={sending}>
                Cancelar
              </Button>
              <Button size="touch" className="text-base" onClick={onConfirm} disabled={sending}>
                {sending ? (
                  <><Loader2 className="h-5 w-5 animate-spin" /> Enviando…</>
                ) : (
                  <><Send className="h-4 w-4" /> Confirmar y enviar</>
                )}
              </Button>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
