import { useEffect, useState, useCallback } from 'react';
import { Loader2, Download, Pencil, X, ImageOff, ChevronRight, FileText } from 'lucide-react';
import toast from 'react-hot-toast';

import { useAuth }        from '@/context/AuthContext';
import { reportApi, photoApi, vehicleApi } from '@/api/endpoints';
import { PageHeader }     from '@/components/layouts/OpsShell';
import { StatusBadge }    from '@/components/StatusBadge';
import { InspectionForm } from '@/components/InspectionForm';
import { shiftLabel }     from '@/lib/shifts';
import { cn }             from '@/lib/utils';
import type { VehicleDashboardCard, Shift, InspectionStatus } from '@/types';

// ─── Tipos (el payload de /reports/daily trae la inspección completa) ───────────

interface ReportInspection {
  id: string;
  vehicleId: string;
  plate: string;
  shift: Shift;
  guardName: string;
  status: InspectionStatus;
  returnStatus: string;
  finalDriverNameManual?: string;
  finalDriverId?: string;
  authorizedBy?: string;
  expectedReturnDate?: string;
  mileage?: number;
  previousMileage?: number;
  mileageDifference?: number;
  mileageWarningType?: string;
  mileageWarningObservation?: string;
  fuelLevel?: string;
  cleanlinessStatus?: string;
  toolsGeneralStatus?: string;
  exteriorGeneralStatus?: string;
  interiorGeneralStatus?: string;
  generalObservation?: string;
  hasNewIssue?: boolean;
  hasPhotos?: boolean;
  modifiedAfterSeal?: boolean;
  modifiedReason?: string;
  createdAt: string;
  updatedAt?: string;
}

interface DailyReport {
  date: string;
  shift: Shift | null;
  guardNames: string[];
  inspections: ReportInspection[];
  counts: { total: number; reviewed: number; issues: number; notReturned: number; other: number };
}

interface Photo {
  id: string;
  type: string;
  fileName: string;
  storagePath: string;
}

interface VehicleInfo {
  brand: string;
  model: string;
  vehicleType: string;
  year?: number;
}

// ─── Etiquetas legibles ─────────────────────────────────────────────────────────

const FUEL_LABEL: Record<string, string> = {
  empty: 'Vacío', quarter: '1/4', half: '1/2', three_quarters: '3/4', full: 'Lleno',
};
const CLEAN_LABEL: Record<string, string> = {
  clean: 'Limpio', acceptable: 'Aceptable', dirty: 'Sucio', very_dirty: 'Muy sucio',
};
const GENERAL_LABEL: Record<string, string> = {
  ok: 'OK', observed: 'Con observación', damaged: 'Con daño',
};
const TOOLS_LABEL: Record<string, string> = {
  ok: 'OK', missing: 'Faltante', damaged: 'Dañado', not_applicable: 'N/A',
};
const RETURN_LABEL: Record<string, string> = {
  received: 'Recibido', not_returned: 'No retornó', never_left: 'No salió', other: 'Otro',
};
const PHOTO_TYPE_LABEL: Record<string, string> = {
  odometer: 'Odómetro', exterior_damage: 'Daño exterior', interior_damage: 'Daño interior',
  missing_tool: 'Herramienta faltante', cleanliness: 'Limpieza', other: 'Otra',
  non_return_evidence: 'Evidencia de no retorno',
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
function cardFromInspection(insp: ReportInspection, v?: VehicleInfo): VehicleDashboardCard {
  return {
    vehicleId: insp.vehicleId,
    plate: insp.plate,
    vehicleType: v?.vehicleType ?? '', brand: v?.brand ?? '', model: v?.model ?? '',
    currentStatus: 'active',
    hasOpenIssues: !!insp.hasNewIssue,
    todayRecord: { kind: 'received', inspectionId: insp.id, inspectionStatus: insp.status },
    noReviewAlert: false,
    lastMileage: 0,
  };
}

function fmtDateTime(iso: string): string {
  return new Date(iso).toLocaleString('es-GT', {
    day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit',
  });
}

// ─── Galería de fotos + lightbox ────────────────────────────────────────────────

function PhotoGallery({
  photos, loading, onOpen,
}: {
  photos: Photo[] | undefined;
  loading: boolean;
  onOpen: (src: string, label: string) => void;
}) {
  if (loading) {
    return (
      <div className="flex items-center justify-center py-8">
        <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
      </div>
    );
  }
  if (!photos || photos.length === 0) {
    return (
      <div className="flex items-center gap-2 rounded-lg border border-dashed border-border px-4 py-6 text-sm text-muted-foreground">
        <ImageOff className="h-4 w-4" /> Sin fotos en esta inspección.
      </div>
    );
  }
  return (
    <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
      {photos.map((p) => {
        const src = `/api/photos/file/${p.storagePath}`;
        const label = PHOTO_TYPE_LABEL[p.type] ?? p.type;
        return (
          <button
            key={p.id}
            onClick={() => onOpen(src, label)}
            className="group relative overflow-hidden rounded-lg border border-border bg-muted"
            title={label}
          >
            <img
              src={src}
              alt={label}
              loading="lazy"
              className="aspect-[4/3] h-full w-full object-cover transition-transform group-hover:scale-105"
            />
            <span className="absolute inset-x-0 bottom-0 bg-black/55 px-2 py-1 text-left text-[11px] font-medium text-white">
              {label}
            </span>
          </button>
        );
      })}
    </div>
  );
}

function Lightbox({ src, label, onClose }: { src: string; label: string; onClose: () => void }) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  return (
    <div
      onClick={onClose}
      className="fixed inset-0 z-50 flex flex-col items-center justify-center bg-black/80 p-6"
    >
      <button
        onClick={onClose}
        className="absolute right-5 top-5 rounded-full bg-white/10 p-2 text-white hover:bg-white/20"
        aria-label="Cerrar"
      >
        <X className="h-5 w-5" />
      </button>
      <img
        src={src}
        alt={label}
        onClick={(e) => e.stopPropagation()}
        className="max-h-[85vh] max-w-full rounded-lg object-contain shadow-2xl"
      />
      <span className="mt-3 text-sm font-medium text-white/90">{label}</span>
    </div>
  );
}

// ─── Fila de detalle ──────────────────────────────────────────────────────────

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <div className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">{label}</div>
      <div className="mt-0.5 text-sm text-foreground">{children}</div>
    </div>
  );
}

// ─── Panel de detalle ───────────────────────────────────────────────────────────

function InspectionDetail({
  insp, vehicle, photos, photosLoading, onOpenPhoto, onEdit, canEdit,
}: {
  insp: ReportInspection;
  vehicle?: VehicleInfo;
  photos: Photo[] | undefined;
  photosLoading: boolean;
  onOpenPhoto: (src: string, label: string) => void;
  onEdit: () => void;
  canEdit: boolean;
}) {
  const km = insp.mileage;
  const diff = insp.mileageDifference;
  return (
    <div className="space-y-6">
      {/* Encabezado del vehículo */}
      <div className="flex items-start justify-between gap-4">
        <div>
          <div className="flex items-center gap-3">
            <span className="font-mono text-2xl font-bold">{insp.plate}</span>
            <StatusBadge status={insp.status} />
          </div>
          <div className="mt-1 text-sm text-muted-foreground">
            {vehicle
              ? `${vehicle.vehicleType ? vehicle.vehicleType + ' · ' : ''}${vehicle.brand} ${vehicle.model}${vehicle.year ? ' ' + vehicle.year : ''}`
              : 'Cargando vehículo…'}
          </div>
          <div className="mt-1 flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
            <span className={cn('inline-flex rounded border px-1.5 font-semibold', SHIFT_PILL[insp.shift] ?? '')}>
              {shiftLabel(insp.shift)}
            </span>
            <span>· {fmtDateTime(insp.createdAt)}</span>
            <span>· Guardia: {insp.guardName}</span>
            {insp.modifiedAfterSeal && (
              <span className="rounded-full bg-amber-100 px-2 py-0.5 font-semibold text-amber-800">
                Corregido tras cierre
              </span>
            )}
          </div>
        </div>
        {canEdit && (
          <button
            onClick={onEdit}
            className="flex shrink-0 items-center gap-1.5 rounded-lg border border-border px-3 py-2 text-sm font-medium text-muted-foreground hover:bg-muted"
            title="Corregir (requiere justificación)"
          >
            <Pencil className="h-4 w-4" /> Corregir
          </button>
        )}
      </div>

      {/* Datos de la inspección */}
      <div className="grid grid-cols-2 gap-x-6 gap-y-4 rounded-xl border border-border bg-card p-5 sm:grid-cols-3">
        <Field label="Retorno">{RETURN_LABEL[insp.returnStatus] ?? insp.returnStatus}</Field>
        {(insp.finalDriverNameManual || insp.finalDriverId) && (
          <Field label="Conductor">{insp.finalDriverNameManual || `#${insp.finalDriverId}`}</Field>
        )}
        {km != null && (
          <Field label="Kilometraje">
            <b>{km.toLocaleString('es-GT')}</b>
            {insp.previousMileage != null && (
              <span className="text-muted-foreground"> (ant. {insp.previousMileage.toLocaleString('es-GT')}
                {diff != null && <>, {diff >= 0 ? '+' : ''}{diff.toLocaleString('es-GT')}</>})
              </span>
            )}
          </Field>
        )}
        {insp.fuelLevel && <Field label="Combustible">{FUEL_LABEL[insp.fuelLevel] ?? insp.fuelLevel}</Field>}
        {insp.cleanlinessStatus && <Field label="Limpieza">{CLEAN_LABEL[insp.cleanlinessStatus] ?? insp.cleanlinessStatus}</Field>}
        {insp.exteriorGeneralStatus && <Field label="Exterior">{GENERAL_LABEL[insp.exteriorGeneralStatus] ?? insp.exteriorGeneralStatus}</Field>}
        {insp.interiorGeneralStatus && <Field label="Interior">{GENERAL_LABEL[insp.interiorGeneralStatus] ?? insp.interiorGeneralStatus}</Field>}
        {insp.toolsGeneralStatus && <Field label="Herramientas">{TOOLS_LABEL[insp.toolsGeneralStatus] ?? insp.toolsGeneralStatus}</Field>}
        {insp.authorizedBy && <Field label="Autorizado por">{insp.authorizedBy}</Field>}
        {insp.expectedReturnDate && <Field label="Retorno esperado">{insp.expectedReturnDate}</Field>}
      </div>

      {(insp.generalObservation || insp.mileageWarningObservation) && (
        <div className="space-y-3">
          {insp.generalObservation && (
            <div className="rounded-xl border border-border bg-card p-4">
              <div className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">Observación</div>
              <p className="mt-1 text-sm italic">{insp.generalObservation}</p>
            </div>
          )}
          {insp.mileageWarningType && insp.mileageWarningType !== 'none' && insp.mileageWarningObservation && (
            <div className="rounded-xl border border-amber-200 bg-amber-50 p-4">
              <div className="text-xs font-semibold uppercase tracking-wider text-amber-800">Alerta de kilometraje confirmada</div>
              <p className="mt-1 text-sm italic text-amber-900">{insp.mileageWarningObservation}</p>
            </div>
          )}
          {insp.modifiedAfterSeal && insp.modifiedReason && (
            <div className="rounded-xl border border-border bg-card p-4">
              <div className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">Motivo de la corrección</div>
              <p className="mt-1 text-sm italic">{insp.modifiedReason}</p>
            </div>
          )}
        </div>
      )}

      {/* Evidencia fotográfica */}
      <div>
        <h3 className="mb-3 text-sm font-semibold uppercase tracking-wider text-muted-foreground">Evidencia fotográfica</h3>
        <PhotoGallery photos={photos} loading={photosLoading} onOpen={onOpenPhoto} />
      </div>
    </div>
  );
}

// ─── Control de descarga PDF (rango de fechas / últimos N) ───────────────────────

function PdfExportControl({ defaultDate }: { defaultDate: string }) {
  const [open, setOpen]   = useState(false);
  const [mode, setMode]   = useState<'range' | 'last'>('range');
  const [from, setFrom]   = useState(defaultDate);
  const [to, setTo]       = useState(defaultDate);
  const [last, setLast]   = useState(10);
  const [busy, setBusy]   = useState(false);

  const download = async () => {
    setBusy(true);
    try {
      const params = mode === 'last' ? { last } : { from, to };
      const res = await reportApi.exportPdf(params);
      const url = URL.createObjectURL(new Blob([res.data], { type: 'application/pdf' }));
      const a = document.createElement('a');
      a.href = url;
      a.download = mode === 'last' ? `inspecciones_ultimas_${last}.pdf` : `inspecciones_${from}_a_${to}.pdf`;
      a.click();
      URL.revokeObjectURL(url);
      setOpen(false);
    } catch {
      // El error viene como Blob (responseType blob); mensaje genérico.
      toast.error('No se pudo generar el PDF. Revisa los filtros.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="relative">
      <button
        onClick={() => setOpen(o => !o)}
        className="flex items-center gap-1.5 rounded-lg border border-border px-3 py-2 text-sm font-medium text-muted-foreground hover:bg-muted"
      >
        <FileText className="h-4 w-4" /> PDF
      </button>

      {open && (
        <>
          {/* click-away */}
          <button
            className="fixed inset-0 z-40 cursor-default"
            aria-hidden
            onClick={() => setOpen(false)}
          />
          <div className="absolute right-0 z-50 mt-2 w-72 rounded-xl border border-border bg-card p-4 shadow-xl">
            <p className="mb-3 text-sm font-semibold">Descargar PDF</p>

            {/* Selector de modo */}
            <div className="mb-3 grid grid-cols-2 gap-1 rounded-lg border border-border p-1">
              {([['range', 'Rango'], ['last', 'Últimos N']] as const).map(([v, label]) => (
                <button
                  key={v}
                  onClick={() => setMode(v)}
                  className={cn(
                    'rounded-md px-2 py-1.5 text-xs font-medium transition-colors',
                    mode === v ? 'bg-primary text-primary-foreground' : 'text-muted-foreground hover:bg-muted',
                  )}
                >
                  {label}
                </button>
              ))}
            </div>

            {mode === 'range' ? (
              <div className="space-y-2">
                <label className="block">
                  <span className="text-xs text-muted-foreground">Desde</span>
                  <input type="date" value={from} max={to} onChange={e => setFrom(e.target.value)} className="input-box mt-0.5 w-full" />
                </label>
                <label className="block">
                  <span className="text-xs text-muted-foreground">Hasta</span>
                  <input type="date" value={to} min={from} onChange={e => setTo(e.target.value)} className="input-box mt-0.5 w-full" />
                </label>
              </div>
            ) : (
              <label className="block">
                <span className="text-xs text-muted-foreground">Cantidad de reportes más recientes</span>
                <input
                  type="number" min={1} max={100} value={last}
                  onChange={e => setLast(Math.min(100, Math.max(1, parseInt(e.target.value || '1', 10))))}
                  className="input-box mt-0.5 w-full"
                />
              </label>
            )}

            <button
              disabled={busy}
              onClick={download}
              className="mt-3 flex w-full items-center justify-center gap-1.5 rounded-lg bg-primary px-3 py-2 text-sm font-medium text-primary-foreground hover:opacity-90 disabled:opacity-40"
            >
              {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Download className="h-4 w-4" />}
              Descargar PDF
            </button>
          </div>
        </>
      )}
    </div>
  );
}

// ─── Página ─────────────────────────────────────────────────────────────────────

export function ReportsPage() {
  const { canModifyAfterSubmit } = useAuth();

  const [date, setDate]           = useState(todayISO());
  const [shift, setShift]         = useState<'' | Shift>('');
  const [report, setReport]       = useState<DailyReport | null>(null);
  const [loading, setLoading]     = useState(true);
  const [exporting, setExporting] = useState(false);
  const [editing, setEditing]     = useState<ReportInspection | null>(null);

  const [selectedId, setSelectedId]   = useState<string | null>(null);
  const [photosById, setPhotosById]   = useState<Record<string, Photo[]>>({});
  const [photosLoading, setPhotosLoading] = useState(false);
  const [vehicleById, setVehicleById] = useState<Record<string, VehicleInfo>>({});
  const [lightbox, setLightbox]       = useState<{ src: string; label: string } | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const r = await reportApi.daily(date, shift || undefined);
      const data = r.data.data as DailyReport;
      setReport(data);
      // Selecciona la primera inspección automáticamente
      setSelectedId(data.inspections[0]?.id ?? null);
    } catch {
      toast.error('No se pudo cargar el reporte.');
      setReport(null);
      setSelectedId(null);
    } finally {
      setLoading(false);
    }
  }, [date, shift]);

  useEffect(() => { load(); }, [load]);

  const inspections = report?.inspections ?? [];
  const selected = inspections.find((i) => i.id === selectedId) ?? null;

  // Carga perezosa de fotos + datos del vehículo del reporte seleccionado.
  useEffect(() => {
    if (!selected) return;

    if (!photosById[selected.id]) {
      setPhotosLoading(true);
      photoApi.list(selected.id)
        .then((r) => setPhotosById((m) => ({ ...m, [selected.id]: (r.data.data as Photo[]) ?? [] })))
        .catch(() => setPhotosById((m) => ({ ...m, [selected.id]: [] })))
        .finally(() => setPhotosLoading(false));
    }

    if (!vehicleById[selected.vehicleId]) {
      vehicleApi.get(selected.vehicleId)
        .then((r) => {
          const v = r.data.data as VehicleInfo;
          setVehicleById((m) => ({ ...m, [selected.vehicleId]: v }));
        })
        .catch(() => {});
    }
  }, [selected, photosById, vehicleById]);

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
        card={cardFromInspection(editing, vehicleById[editing.vehicleId])}
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

  return (
    <div className="flex flex-1 flex-col overflow-hidden">
      <PageHeader
        title="Reportes por turno"
        subtitle="Stream de inspecciones por fecha y turno"
        action={
          <div className="flex items-center gap-2">
            <button
              disabled={exporting || inspections.length === 0}
              onClick={handleExport}
              className="flex items-center gap-1.5 rounded-lg border border-border px-3 py-2 text-sm font-medium text-muted-foreground hover:bg-muted disabled:opacity-40"
            >
              {exporting ? <Loader2 className="h-4 w-4 animate-spin" /> : <Download className="h-4 w-4" />}
              Exportar .xlsx
            </button>
            <PdfExportControl defaultDate={date} />
          </div>
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

      {/* Master-detail */}
      {loading ? (
        <div className="flex flex-1 items-center justify-center"><Loader2 className="h-7 w-7 animate-spin text-muted-foreground" /></div>
      ) : inspections.length === 0 ? (
        <div className="flex flex-1 items-center justify-center text-muted-foreground">Sin inspecciones para esta fecha/turno.</div>
      ) : (
        <div className="flex flex-1 flex-col overflow-hidden md:flex-row">
          {/* Lista (master) */}
          <div className="flex-shrink-0 overflow-auto border-b border-border md:w-80 md:border-b-0 md:border-r">
            <ul className="divide-y divide-border">
              {inspections.map((insp) => {
                const active = insp.id === selectedId;
                return (
                  <li key={insp.id}>
                    <button
                      onClick={() => setSelectedId(insp.id)}
                      className={cn(
                        'flex w-full items-center gap-3 px-4 py-3 text-left transition-colors',
                        active ? 'bg-primary/10' : 'hover:bg-muted',
                      )}
                    >
                      <div className="min-w-0 flex-1">
                        <div className="flex items-center gap-2">
                          <span className="font-mono text-base font-bold">{insp.plate}</span>
                          {insp.hasNewIssue && <span className="h-2 w-2 shrink-0 rounded-full bg-red-500" title="Con daño" />}
                        </div>
                        <div className="mt-0.5 flex items-center gap-1.5 text-xs text-muted-foreground">
                          <span className={cn('inline-flex rounded border px-1 font-semibold', SHIFT_PILL[insp.shift] ?? '')}>
                            {shiftLabel(insp.shift)}
                          </span>
                          <span className="truncate">{insp.guardName}</span>
                        </div>
                      </div>
                      <StatusBadge status={insp.status} className="shrink-0 text-[11px]" />
                      <ChevronRight className={cn('h-4 w-4 shrink-0 text-muted-foreground', active && 'text-primary')} />
                    </button>
                  </li>
                );
              })}
            </ul>
          </div>

          {/* Detalle */}
          <div className="flex-1 overflow-auto px-6 py-5">
            {selected ? (
              <div className="mx-auto max-w-2xl">
                <InspectionDetail
                  insp={selected}
                  vehicle={vehicleById[selected.vehicleId]}
                  photos={photosById[selected.id]}
                  photosLoading={photosLoading && !photosById[selected.id]}
                  onOpenPhoto={(src, label) => setLightbox({ src, label })}
                  onEdit={() => setEditing(selected)}
                  canEdit={canModifyAfterSubmit}
                />
              </div>
            ) : (
              <div className="flex h-full items-center justify-center text-muted-foreground">
                Selecciona un reporte para ver el detalle.
              </div>
            )}
          </div>
        </div>
      )}

      {lightbox && (
        <Lightbox src={lightbox.src} label={lightbox.label} onClose={() => setLightbox(null)} />
      )}
    </div>
  );
}
