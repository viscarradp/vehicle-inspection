import React, { useState, useEffect, useCallback } from 'react';
import toast from 'react-hot-toast';
import {
  AlertTriangle, Check, Camera,
  ChevronLeft, ChevronRight, Loader2, Send,
} from 'lucide-react';
import { inspectionApi, driverApi, photoApi } from '../api/endpoints';
import { InspectionFormData, Driver, MileageWarning, VehicleDashboardCard } from '../types';
import { useInspectionSettings } from '@/hooks/useInspectionSettings';
import { KmModal } from './KmModal';
import { StatusBadge } from './StatusBadge';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';

// ─── Constants ───────────────────────────────────────────────────────────────

const BLOCKS = [
  { k: '1',  t: 'Datos del vehículo' },
  { k: '2',  t: 'Conductor' },
  { k: '3',  t: 'Kilometraje' },
  { k: '4',  t: 'Combustible' },
  { k: '5',  t: 'Limpieza' },
  { k: '6',  t: 'Herramientas' },
  { k: '7',  t: 'Daño exterior' },
  { k: '8',  t: 'Daño interior' },
  { k: '9',  t: 'Observación' },
  { k: '10', t: 'Fotos' },
  { k: '✓',  t: 'Revisar' },
];

const FUEL_OPTS  = ['Vacío', '1/4', '1/2', '3/4', 'Lleno'];
const CLEAN_OPTS = [
  { t: 'Limpio',    icon: '✨' },
  { t: 'Aceptable', icon: '👍' },
  { t: 'Sucio',     icon: '🌫️' },
  { t: 'Muy sucio', icon: '⚠️' },
];
const TOOLS_LIST = [
  'Llanta de repuesto', 'Tricket', 'Llave de ruedas', 'Extintor',
  'Triángulo / conos', 'Chaleco reflectivo', 'Documentos del vehículo',
  'Tarjeta de circulación', 'Botiquín', 'Herramienta asignada',
];
const EXT_DMG = [
  'Rayones', 'Golpes', 'Abolladuras', 'Luces dañadas', 'Espejos',
  'Vidrios / parabrisas', 'Llantas', 'Defensa', 'Carrocería', 'Otro',
];
const TOOL_STATES = ['ok', 'falta', 'dañado', 'n/a'] as const;
type ToolState = typeof TOOL_STATES[number];

const PHOTO_SLOTS = [
  { label: 'Odómetro',      type: 'odometer' },
  { label: 'Daño exterior', type: 'exterior_damage' },
  { label: 'Daño interior', type: 'interior_damage' },
  { label: 'Limpieza',      type: 'cleanliness' },
  { label: 'Otro',          type: 'other' },
];

const FUEL_IDX:  Record<string, number> = { empty: 0, quarter: 1, half: 2, three_quarters: 3, full: 4 };
const CLEAN_IDX: Record<string, number> = { clean: 0, acceptable: 1, dirty: 2, very_dirty: 3 };

const TOOL_ACTIVE: Record<ToolState, string> = {
  ok:     'bg-emerald-100 border-emerald-500 text-emerald-700',
  falta:  'bg-red-100     border-red-400     text-red-700',
  dañado: 'bg-amber-100   border-amber-400   text-amber-700',
  'n/a':  'bg-muted       border-border      text-muted-foreground',
};
const TOOL_LABEL: Record<ToolState, string> = {
  ok: 'OK', falta: 'Falta', dañado: 'Daño', 'n/a': 'N/A',
};

// ─── Block 1 — Vehicle summary ────────────────────────────────────────────────

function Block1({ card, loadedReturnStatus, isSealed }: {
  card: VehicleDashboardCard;
  /** Populated only when supervisor opens a non-received inspection for review. */
  loadedReturnStatus?: string;
  isSealed?: boolean;
}) {
  const isAbsence = isSealed && loadedReturnStatus && loadedReturnStatus !== 'received';

  return (
    <div className="flex flex-col gap-4">
      <div className="grid grid-cols-2 gap-4">
        <div>
          <p className="mb-1 text-sm font-medium text-muted-foreground">Placa</p>
          <p className="font-mono text-4xl font-bold leading-none tracking-wider">
            {card.plate}
          </p>
        </div>
        <div className="flex flex-col justify-center">
          <p className="mb-1 text-sm font-medium text-muted-foreground">Vehículo</p>
          <p className="text-lg leading-snug text-foreground/80">
            {card.vehicleType} {card.brand} {card.model}
          </p>
        </div>
      </div>

      {/* For supervisor viewing an absence inspection, show the recorded status */}
      {isAbsence && (
        <div className="flex items-center gap-3 rounded-lg border border-border bg-muted/40 px-4 py-3">
          <p className="text-sm text-muted-foreground">Estado registrado:</p>
          <StatusBadge status={loadedReturnStatus!} />
        </div>
      )}

      {card.hasOpenIssues && (
        <div className="flex items-start gap-3 rounded-lg border border-red-200 bg-red-50 p-4">
          <AlertTriangle className="mt-0.5 h-5 w-5 shrink-0 text-red-600" />
          <div>
            <p className="font-semibold text-red-800">Daños abiertos registrados</p>
            <p className="mt-0.5 text-sm text-red-700">
              Revisa los problemas pendientes con el jefe de operaciones.
            </p>
          </div>
        </div>
      )}

      {card.noReviewAlert && (
        <div className="flex items-center gap-3 rounded-lg border border-amber-200 bg-amber-50 p-4">
          <AlertTriangle className="h-5 w-5 shrink-0 text-amber-600" />
          <p className="font-semibold text-amber-800">
            {card.daysSinceLastReview} días sin revisión
          </p>
        </div>
      )}
    </div>
  );
}

// ─── Block 2 — Driver selection ───────────────────────────────────────────────

function Block2({ drivers, driver, setDriver, other, setOther }: {
  drivers: Driver[];
  driver: string;
  setDriver: (v: string) => void;
  other: string;
  setOther: (v: string) => void;
}) {
  return (
    <div className="flex flex-col gap-4">
      <p className="text-base text-muted-foreground">
        ¿Quién entregó el vehículo en esta jornada?
      </p>
      <div className="grid grid-cols-2 gap-3">
        {drivers.map(d => (
          <button
            key={d.id}
            onClick={() => setDriver(d.id)}
            className={cn('shift-pill p-4 text-left', driver === d.id && 'is-on')}
          >
            <span className="block text-base font-medium">{d.name}</span>
            {d.department && (
              <span className="block text-sm opacity-70">{d.department}</span>
            )}
          </button>
        ))}
        <button
          onClick={() => setDriver('otro')}
          className={cn('shift-pill p-4 text-left text-base', driver === 'otro' && 'is-on')}
        >
          Otro conductor…
        </button>
      </div>

      {driver === 'otro' && (
        <div className="animate-[modalIn_.2s_var(--press)]">
          <p className="mb-1 text-sm font-medium text-muted-foreground">Nombre completo</p>
          <input
            className="input-line text-xl"
            placeholder="Escribe el nombre…"
            value={other}
            onChange={e => setOther(e.target.value)}
            autoFocus
          />
        </div>
      )}
    </div>
  );
}

// ─── Block 3 — Odometer ───────────────────────────────────────────────────────

function Block3({ prevKm, km, setKm, onAlert, highThreshold }: {
  prevKm: number;
  km: string;
  setKm: (v: string) => void;
  onAlert: () => void;
  highThreshold: number;
}) {
  const val     = parseInt(km || '0', 10);
  const diff    = val - prevKm;
  const isLower = val > 0 && val < prevKm;
  const isHigh  = val > 0 && diff > highThreshold;
  const hasWarn = isLower || isHigh;
  const isClean = val > 0 && !hasWarn;

  return (
    <div className="flex flex-col gap-5">
      <div className="flex items-baseline gap-2 rounded-lg border border-border bg-muted/40 px-5 py-4">
        <span className="text-sm text-muted-foreground">Último registrado:</span>
        <span className="ml-1 font-mono text-2xl font-bold">
          {prevKm.toLocaleString('es-GT')}
        </span>
        <span className="text-base text-muted-foreground">km</span>
      </div>

      <div>
        <p className="mb-2 text-sm font-medium text-muted-foreground">
          Lectura actual del odómetro{' '}
          <span className="text-red-600">*</span>
        </p>
        <div className="flex items-baseline gap-3">
          <input
            className={cn(
              'input-line mono flex-1 text-5xl font-bold',
              hasWarn && 'is-error',
            )}
            type="number"
            inputMode="numeric"
            value={km}
            onChange={e => setKm(e.target.value)}
            placeholder="0"
          />
          <span className="text-xl text-muted-foreground">km</span>
        </div>
        {isClean && (
          <p className="mt-2 font-mono text-sm text-muted-foreground">
            +{diff.toLocaleString('es-GT')} km desde la última revisión
          </p>
        )}
      </div>

      {hasWarn && (
        <div className="animate-[modalIn_.22s_var(--press)] flex flex-col gap-4 rounded-lg border border-red-200 bg-red-50 p-5">
          <div className="flex items-start gap-3">
            <AlertTriangle className="mt-0.5 h-5 w-5 shrink-0 text-red-600" />
            <div>
              <p className="font-semibold text-red-800">
                {isLower
                  ? 'El kilometraje es MENOR al último registrado.'
                  : 'Uso inusualmente alto detectado.'}
              </p>
              <p className="mt-1 font-mono text-sm text-red-700">
                Diferencia:{' '}
                <strong>{diff > 0 ? '+' : ''}{diff.toLocaleString('es-GT')} km</strong>.{' '}
                Verifica la lectura antes de continuar.
              </p>
            </div>
          </div>
          <div className="flex gap-3">
            <Button variant="outline" className="flex-1" onClick={() => setKm(String(prevKm))}>
              Corregir valor
            </Button>
            <Button className="flex-1" onClick={onAlert}>
              Confirmar con justificación
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}

// ─── Block 4 — Fuel level ─────────────────────────────────────────────────────

function Block4({ fuel, setFuel }: { fuel: number; setFuel: (v: number) => void }) {
  const pcts = [0, 25, 50, 75, 100];
  return (
    <div className="flex gap-3">
      {FUEL_OPTS.map((t, i) => (
        <button
          key={t}
          onClick={() => setFuel(i)}
          className={cn(
            'shift-pill flex flex-1 flex-col items-center gap-3 p-4',
            fuel === i && 'is-on',
          )}
        >
          <div className="relative h-14 w-full overflow-hidden rounded border-[1.5px] border-current bg-foreground/5">
            <div
              className="absolute inset-x-0 bottom-0 transition-[height] duration-300"
              style={{
                height: `${pcts[i]}%`,
                background: fuel === i
                  ? 'hsl(var(--primary-foreground) / 0.8)'
                  : 'hsl(var(--primary) / 0.5)',
              }}
            />
          </div>
          <span className="text-sm font-semibold">{t}</span>
        </button>
      ))}
    </div>
  );
}

// ─── Block 5 — Cleanliness ────────────────────────────────────────────────────

function Block5({ clean, setClean }: { clean: number; setClean: (v: number) => void }) {
  return (
    <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
      {CLEAN_OPTS.map(({ t, icon }, i) => (
        <button
          key={t}
          onClick={() => setClean(i)}
          className={cn(
            'shift-pill flex flex-col items-center gap-3 p-5 text-base',
            clean === i && 'is-on',
          )}
        >
          <span className="text-3xl">{icon}</span>
          <span className="font-medium">{t}</span>
        </button>
      ))}
    </div>
  );
}

// ─── Block 6 — Tool kit ───────────────────────────────────────────────────────

function Block6({ tools, setTools }: {
  tools: Record<string, ToolState>;
  setTools: (v: Record<string, ToolState>) => void;
}) {
  return (
    <div className="divide-y divide-border">
      {TOOLS_LIST.map(name => (
        <div
          key={name}
          className="flex items-center justify-between gap-4 py-3 first:pt-0 last:pb-0"
        >
          <span className="text-base font-medium">{name}</span>
          <div className="flex shrink-0 gap-2">
            {TOOL_STATES.map(s => (
              <button
                key={s}
                onClick={() => setTools({ ...tools, [name]: s })}
                className={cn(
                  'rounded-lg border px-3 py-2.5 text-sm font-semibold transition-all',
                  tools[name] === s
                    ? TOOL_ACTIVE[s]
                    : 'border-border bg-transparent text-muted-foreground hover:bg-muted',
                )}
              >
                {TOOL_LABEL[s]}
              </button>
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}

// ─── Block 7 / 8 — Damage areas ──────────────────────────────────────────────

function BlockDamage({ picks, setPicks }: {
  picks: Record<string, boolean>;
  setPicks: (v: Record<string, boolean>) => void;
}) {
  const noDamage = !Object.values(picks).some(Boolean);
  return (
    <div className="flex flex-col gap-4">
      <button
        onClick={() => setPicks({})}
        className={cn(
          'flex w-full items-center justify-center gap-3 rounded-xl border-2 p-5 text-lg font-semibold transition-all',
          noDamage
            ? 'border-emerald-500 bg-emerald-50 text-emerald-700'
            : 'border-border bg-card text-muted-foreground hover:bg-muted',
        )}
      >
        {noDamage && <Check className="h-6 w-6" />}
        Sin daños visibles
      </button>
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
        {EXT_DMG.map(d => (
          <button
            key={d}
            onClick={() => setPicks({ ...picks, [d]: !picks[d] })}
            className={cn('shift-pill p-4 text-sm font-medium', picks[d] && 'is-on')}
          >
            {d}
          </button>
        ))}
      </div>
    </div>
  );
}

// ─── Block 9 — Observations ───────────────────────────────────────────────────

function Block9({ obs, setObs }: { obs: string; setObs: (v: string) => void }) {
  return (
    <textarea
      className="input-box w-full resize-y text-base leading-relaxed"
      placeholder="Anota cualquier detalle adicional que deba quedar registrado…"
      rows={5}
      value={obs}
      onChange={e => setObs(e.target.value)}
    />
  );
}

// ─── Block 10 — Photo evidence ────────────────────────────────────────────────

function Block10({ files, setFiles }: {
  files: Record<string, File | null>;
  setFiles: (v: Record<string, File | null>) => void;
}) {
  return (
    <div className="flex flex-col gap-4">
      <p className="text-sm text-muted-foreground">
        Toca una ranura para capturar o seleccionar una foto. Las imágenes quedan adjuntas a la inspección.
      </p>
      <div className="grid grid-cols-2 gap-4 sm:grid-cols-3">
        {PHOTO_SLOTS.map(s => {
          const file    = files[s.type] ?? null;
          const preview = file ? URL.createObjectURL(file) : null;
          return (
            <label
              key={s.type}
              className={cn(
                'photo-slot aspect-[4/3] cursor-pointer rounded-xl',
                preview && 'is-done',
              )}
            >
              <input
                type="file"
                accept="image/*"
                capture="environment"
                className="sr-only"
                onChange={e => {
                  const f = e.target.files?.[0] ?? null;
                  setFiles({ ...files, [s.type]: f });
                }}
              />
              {preview ? (
                <div className="relative h-full w-full overflow-hidden rounded-xl">
                  <img src={preview} alt={s.label} className="h-full w-full object-cover" />
                  <div className="absolute inset-x-0 bottom-0 bg-black/50 py-1.5 text-center text-xs font-medium text-white">
                    {s.label} ✓
                  </div>
                </div>
              ) : (
                <>
                  <Camera className="h-8 w-8 text-muted-foreground" />
                  <span className="text-sm text-muted-foreground">{s.label}</span>
                </>
              )}
            </label>
          );
        })}
      </div>
    </div>
  );
}

// ─── Block 11 — Preview / Revisar ─────────────────────────────────────────────

function PreviewRow({ label, value, warn }: { label: string; value: string; warn?: boolean }) {
  return (
    <div className="flex items-baseline justify-between gap-4 py-2.5">
      <span className="shrink-0 text-sm text-muted-foreground">{label}</span>
      <span className={cn('text-right text-base font-medium', warn && 'text-red-600')}>
        {value}
      </span>
    </div>
  );
}

function BlockPreview({
  driverName, km, prevKm, fuel, clean, tools, extDmg, intDmg, obs, photoFiles, isDraftFlow,
}: {
  driverName: string;
  km: string;
  prevKm: number;
  fuel: number;
  clean: number;
  tools: Record<string, ToolState>;
  extDmg: Record<string, boolean>;
  intDmg: Record<string, boolean>;
  obs: string;
  photoFiles: Record<string, File | null>;
  /** Flujo de guardia: el envío se hace desde el panel, no aquí. */
  isDraftFlow: boolean;
}) {
  const kmVal   = parseInt(km || '0', 10);
  const kmDiff  = kmVal - prevKm;
  const kmWarn  = kmVal > 0 && kmVal < prevKm;
  const extList = Object.keys(extDmg).filter(k => extDmg[k]);
  const intList = Object.keys(intDmg).filter(k => intDmg[k]);
  const toolBad = TOOLS_LIST.filter(t => tools[t] === 'falta' || tools[t] === 'dañado');
  const photos  = Object.entries(photoFiles).filter(([, f]) => f !== null);
  const hasFindings = extList.length > 0 || intList.length > 0 || toolBad.length > 0;

  return (
    <div className="flex flex-col gap-5">
      <p className="text-sm text-muted-foreground">
        Revisa el reporte. Puedes volver a cualquier paso para corregir.
      </p>

      {isDraftFlow && (
        <div className="flex items-start gap-3 rounded-lg border border-blue-200 bg-blue-50 p-4">
          <Send className="mt-0.5 h-5 w-5 shrink-0 text-blue-600" />
          <div>
            <p className="font-semibold text-blue-800">Este reporte aún no se envía</p>
            <p className="mt-0.5 text-sm text-blue-700">
              Guarda el borrador y, en el panel, presiona <strong>Enviar</strong> en la
              tarjeta del vehículo para registrar la revisión.
            </p>
          </div>
        </div>
      )}

      <div className="divide-y divide-border rounded-lg border border-border bg-muted/30 px-4">
        <PreviewRow label="Conductor" value={driverName || '— sin asignar'} warn={!driverName} />
        <PreviewRow
          label="Kilometraje"
          value={kmVal > 0 ? `${kmVal.toLocaleString('es-GT')} km (${kmDiff >= 0 ? '+' : ''}${kmDiff.toLocaleString('es-GT')})` : '— sin lectura'}
          warn={kmVal <= 0 || kmWarn}
        />
        <PreviewRow label="Combustible" value={FUEL_OPTS[fuel]} />
        <PreviewRow label="Limpieza" value={CLEAN_OPTS[clean].t} />
        <PreviewRow
          label="Herramientas"
          value={toolBad.length ? `${toolBad.length} con faltante/daño` : 'Completas'}
          warn={toolBad.length > 0}
        />
        <PreviewRow
          label="Daño exterior"
          value={extList.length ? extList.join(', ') : 'Sin daños'}
          warn={extList.length > 0}
        />
        <PreviewRow
          label="Daño interior"
          value={intList.length ? intList.join(', ') : 'Sin daños'}
          warn={intList.length > 0}
        />
        <PreviewRow label="Fotos" value={photos.length ? `${photos.length} adjunta(s)` : 'Ninguna'} />
      </div>

      {obs.trim() && (
        <div className="rounded-lg border border-border bg-card p-4">
          <p className="mb-1 text-sm font-medium text-muted-foreground">Observación</p>
          <p className="whitespace-pre-line text-base leading-relaxed">{obs}</p>
        </div>
      )}

      {hasFindings && photos.length === 0 && (
        <div className="flex items-start gap-3 rounded-lg border border-amber-200 bg-amber-50 p-4">
          <AlertTriangle className="mt-0.5 h-5 w-5 shrink-0 text-amber-600" />
          <p className="text-sm text-amber-800">
            Hay daños o faltantes registrados. Se requiere al menos una foto para finalizar.
          </p>
        </div>
      )}
    </div>
  );
}

// ─── Main component ───────────────────────────────────────────────────────────

interface Props {
  card: VehicleDashboardCard;
  /** Id de un registro existente a precargar (turno actual del guardia o edición del supervisor). */
  loadFromId?: string;
  /** Si true, guarda vía PATCH /:id (edición de supervisor). Si false, POST (upsert del turno actual). */
  editById?: boolean;
  /** La inspección pertenece a un turno ya cerrado (sellada) → requiere motivo. */
  isSealed?: boolean;
  /** Permiso de supervisor para modificar una inspección sellada. */
  canModify?: boolean;
  onSaved: () => void;
  onBack: () => void;
  /** Último km registrado del vehículo — baseline para la alerta local de odómetro. */
  initialPrevKm?: number;
}

export function InspectionForm({ card, loadFromId, editById, isSealed, canModify, onSaved, onBack, initialPrevKm }: Props) {
  const { settings: inspSettings } = useInspectionSettings();
  const [step, setStep]                       = useState(0);
  const [saving, setSaving]                   = useState(false);
  const [loadingData, setLoadingData]         = useState(!!loadFromId);
  const [drivers, setDrivers]                 = useState<Driver[]>([]);
  const [kmModal, setKmModal]                 = useState<MileageWarning | null>(null);
  const [kmModalSource, setKmModalSource]     = useState<'local' | 'api'>('local');
  const [photoFiles, setPhotoFiles]           = useState<Record<string, File | null>>({});
  // True si el borrador precargado ya tiene fotos en el servidor (no se rehidratan
  // como File). Evita re-exigir foto al finalizar un borrador con daño que ya la tenía.
  const [serverHasPhotos, setServerHasPhotos] = useState(false);
  const [showModifyModal, setShowModifyModal] = useState(false);
  const [modifyReason, setModifyReason]       = useState('');

  // Tracks which step indices have been visited — drives accurate chip state
  const [visitedSteps, setVisitedSteps] = useState<Set<number>>(new Set([0]));

  // returnStatus is never shown as a form step.
  // For guards: buildData() hardcodes 'received'.
  // For supervisors editing an existing inspection: loaded from API and preserved as-is.
  const [loadedReturnStatus, setLoadedReturnStatus] = useState('');

  // Form fields — prevKm arranca desde lastMileage del vehículo para evitar falsos positivos
  const [prevKm, setPrevKm]               = useState(initialPrevKm ?? 0);
  const [driver, setDriver]               = useState('');
  const [otherDriver, setOtherDriver]     = useState('');
  const [km, setKm]                       = useState('');
  const [kmJustification, setKmJustification] = useState('');
  const [fuel, setFuel]                   = useState(2);
  const [clean, setClean]                 = useState(0);
  const [tools, setTools]                 = useState<Record<string, ToolState>>(() =>
    Object.fromEntries(TOOLS_LIST.map(t => [t, 'ok' as ToolState]))
  );
  const [extDmg, setExtDmg] = useState<Record<string, boolean>>({});
  const [intDmg, setIntDmg] = useState<Record<string, boolean>>({});
  const [obs, setObs]       = useState('');

  useEffect(() => {
    setVisitedSteps(prev => new Set([...prev, step]));
  }, [step]);

  const populateFromInspection = (insp: Record<string, unknown>) => {
    // Load returnStatus for display purposes (Block 1 badge) and buildData preservation
    const rs = insp.returnStatus as string;
    if (rs && rs !== 'pending') setLoadedReturnStatus(rs);

    const fid   = insp.finalDriverId as string | null;
    const fname = insp.finalDriverNameManual as string | null;
    if (fid)        setDriver(fid);
    else if (fname) { setDriver('otro'); setOtherDriver(fname); }
    if (insp.mileage)            setKm(String(insp.mileage));
    if (insp.fuelLevel)          setFuel(FUEL_IDX[insp.fuelLevel as string] ?? 2);
    if (insp.cleanlinessStatus)  setClean(CLEAN_IDX[insp.cleanlinessStatus as string] ?? 0);
    if (insp.generalObservation) setObs(insp.generalObservation as string);
    if (typeof insp.previousMileage === 'number') setPrevKm(insp.previousMileage);
    if (insp.hasPhotos) setServerHasPhotos(true);
  };

  // El borrador vive en el servidor (fuente única de verdad, visible entre
  // dispositivos y en el dashboard). Al precargar siempre se trae de la API.
  useEffect(() => {
    driverApi.list().then(r => setDrivers(r.data.data as Driver[])).catch(() => {});

    if (!loadFromId) { setLoadingData(false); return; }

    inspectionApi.get(loadFromId)
      .then(r => populateFromInspection(r.data.data as Record<string, unknown>))
      .catch(() => {})
      .finally(() => setLoadingData(false));
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const kmVal  = parseInt(km || '0', 10);
  const kmDiff = kmVal - prevKm;
  const total  = BLOCKS.length;
  const isLastStep = step === total - 1;
  const readOnly   = !!isSealed && !canModify;
  const pct        = ((step + 1) / total) * 100;

  const hasDamageOrMissing =
    Object.values(extDmg).some(Boolean) ||
    Object.values(intDmg).some(Boolean) ||
    TOOLS_LIST.some(t => tools[t] === 'falta' || tools[t] === 'dañado');

  const hasAnyPhoto = Object.values(photoFiles).some(Boolean) || serverHasPhotos;

  // A step is "answered" if it has meaningful data — drives the chip ✓ / ! indicator
  const blockHasData = useCallback((i: number): boolean => {
    switch (i) {
      case 0: return true;
      case 1: return !!driver;
      case 2: return !!km && kmVal > 0;
      case 9: return visitedSteps.has(9) && (!hasDamageOrMissing || hasAnyPhoto);
      default: return visitedSteps.has(i);
    }
  }, [driver, km, kmVal, visitedSteps, hasDamageOrMissing, hasAnyPhoto]);

  const buildData = (intent: 'draft' | 'final' = 'final'): InspectionFormData => {
    const extList  = Object.keys(extDmg).filter(k => extDmg[k]).join(', ');
    const intList  = Object.keys(intDmg).filter(k => intDmg[k]).join(', ');
    const toolBad  = TOOLS_LIST.filter(t => tools[t] === 'falta' || tools[t] === 'dañado').join(', ');
    const combined = [
      obs,
      extList ? `Exterior: ${extList}`     : '',
      intList ? `Interior: ${intList}`     : '',
      toolBad ? `Herramientas: ${toolBad}` : '',
    ].filter(Boolean).join('\n');

    const fuelMap  = ['empty', 'quarter', 'half', 'three_quarters', 'full'] as const;
    const cleanMap = ['clean', 'acceptable', 'dirty', 'very_dirty'] as const;
    const missing  = TOOLS_LIST.filter(t => tools[t] === 'falta').length;
    const damaged  = TOOLS_LIST.filter(t => tools[t] === 'dañado').length;

    return {
      // Solo presente en edición por supervisor → endpoints.save usa PATCH /:id.
      inspectionId: editById ? loadFromId : undefined,
      intent,
      vehicleId: card.vehicleId,
      plate: card.plate,
      // Guardia: siempre 'received' (abrió el formulario para inspeccionar/recibir).
      // Supervisor editando un registro no-recibido: preserva el estado cargado.
      returnStatus: (loadedReturnStatus as InspectionFormData['returnStatus']) || 'received',
      finalDriverId: driver && driver !== 'otro' ? driver : undefined,
      finalDriverNameManual: driver === 'otro' ? otherDriver : undefined,
      mileage: kmVal || undefined,
      fuelLevel: fuelMap[fuel],
      cleanlinessStatus: cleanMap[clean],
      toolsGeneralStatus: missing > 0 ? 'missing' : damaged > 0 ? 'damaged' : 'ok',
      exteriorGeneralStatus: Object.values(extDmg).some(Boolean) ? 'damaged' : 'ok',
      interiorGeneralStatus: Object.values(intDmg).some(Boolean) ? 'damaged' : 'ok',
      generalObservation: combined || undefined,
      mileageWarningConfirmed: !!kmJustification,
      mileageWarningObservation: kmJustification || undefined,
    };
  };

  // Sube las fotos capturadas (en memoria) contra el id de inspección.
  // Compartida por el guardado final y el de borrador.
  const uploadPhotos = async (inspectionId: string) => {
    const uploads = Object.entries(photoFiles).filter(([, f]) => f !== null);
    if (uploads.length === 0) return;
    const pt = toast.loading(`Subiendo ${uploads.length} foto(s)…`);
    let failedCount = 0;
    for (const [type, file] of uploads) {
      try {
        await photoApi.upload(inspectionId, file as File, type, card.plate, card.vehicleId);
      } catch {
        failedCount++;
      }
    }
    toast.dismiss(pt);
    if (failedCount > 0) {
      toast.error(
        failedCount === uploads.length
          ? 'No se pudieron subir las fotos. El registro quedó guardado.'
          : `${failedCount} foto(s) no se subieron correctamente.`,
      );
    }
  };

  const doSave = async (data: InspectionFormData) => {
    setSaving(true);
    try {
      const res  = await inspectionApi.save(data);
      const body = res.data;

      if (body.uiState === 'mileage_warning') {
        setKmModalSource('api');
        setKmModal({
          warningType: body.data.warningType,
          previousMileage: body.data.previousMileage,
          newMileage: body.data.newMileage,
          difference: body.data.difference,
          message: body.message,
        });
        setSaving(false);
        return;
      }

      const inspectionId: string = body.data?.inspectionId;
      if (inspectionId) await uploadPhotos(inspectionId);

      toast.success(
        body.uiState === 'open_issue_created'
          ? 'Inspección guardada. Daño registrado para seguimiento.'
          : 'Inspección guardada.'
      );
      onSaved();
    } catch (err: unknown) {
      const msg = (err as { response?: { data?: { message?: string } } }).response?.data?.message;
      toast.error(msg ?? 'Error al guardar.');
      setSaving(false);
    }
  };

  // Guarda un borrador y vuelve al panel. Sin validación bloqueante: persiste el
  // estado actual aunque esté incompleto. Usado por el botón "Guardar borrador"
  // y por la auto-persistencia al salir del formulario con datos capturados.
  const saveDraftAndExit = async () => {
    setSaving(true);
    try {
      const res = await inspectionApi.saveDraft(buildData('draft'));
      const inspectionId: string = res.data.data?.inspectionId;
      if (inspectionId) await uploadPhotos(inspectionId);
      toast.success('Borrador guardado.');
      onSaved();
    } catch (err: unknown) {
      const msg = (err as { response?: { data?: { message?: string } } }).response?.data?.message;
      toast.error(msg ?? 'Error al guardar el borrador.');
      setSaving(false);
    }
  };

  const hasCapturedData = () =>
    !!driver || kmVal > 0 || !!obs.trim() || hasDamageOrMissing || hasAnyPhoto;

  // Salir del formulario: si hay datos capturados (y no es edición sellada de
  // supervisor) se auto-persiste un borrador para no perder el avance.
  const handleBack = () => {
    if (saving) return;
    if (!isSealed && !editById && hasCapturedData()) { saveDraftAndExit(); return; }
    onBack();
  };

  const handleSave = () => {
    if (hasDamageOrMissing && !hasAnyPhoto) {
      toast.error('Se requiere al menos una foto cuando hay daños o herramientas faltantes.');
      setStep(9); // llevar al guardia al paso de fotos
      return;
    }
    if (isSealed && canModify) { setShowModifyModal(true); return; }
    doSave(buildData('final'));
  };

  const handleKmConfirm = async (justification: string) => {
    setKmJustification(justification);
    setKmModal(null);
    if (kmModalSource === 'api') {
      await doSave({ ...buildData(), mileageWarningConfirmed: true, mileageWarningObservation: justification });
    }
  };

  const canAdvance = () => {
    if (step === 1 && !driver) return false; // Driver required
    if (step === 2 && (!km || kmVal <= 0)) return false; // Odometer required
    return true;
  };

  const renderBlock = () => {
    switch (step) {
      case 0: return (
        <Block1
          card={card}
          loadedReturnStatus={loadedReturnStatus}
          isSealed={isSealed}
        />
      );
      case 1: return (
        <Block2
          drivers={drivers} driver={driver} setDriver={setDriver}
          other={otherDriver} setOther={setOtherDriver}
        />
      );
      case 2: return (
        <Block3
          prevKm={prevKm} km={km} setKm={setKm}
          highThreshold={inspSettings.unusually_high_mileage_threshold}
          onAlert={() => {
            setKmModalSource('local');
            setKmModal({
              warningType: kmDiff < 0 ? 'lower_than_previous' : 'unusually_high',
              previousMileage: prevKm, newMileage: kmVal, difference: kmDiff, message: '',
            });
          }}
        />
      );
      case 3: return <Block4 fuel={fuel} setFuel={setFuel} />;
      case 4: return <Block5 clean={clean} setClean={setClean} />;
      case 5: return <Block6 tools={tools} setTools={setTools} />;
      case 6: return <BlockDamage picks={extDmg} setPicks={setExtDmg} />;
      case 7: return <BlockDamage picks={intDmg} setPicks={setIntDmg} />;
      case 8: return <Block9 obs={obs} setObs={setObs} />;
      case 9: return <Block10 files={photoFiles} setFiles={setPhotoFiles} />;
      case 10: return (
        <BlockPreview
          driverName={driver === 'otro' ? otherDriver : (drivers.find(d => d.id === driver)?.name ?? '')}
          km={km} prevKm={prevKm} fuel={fuel} clean={clean}
          tools={tools} extDmg={extDmg} intDmg={intDmg} obs={obs} photoFiles={photoFiles}
          isDraftFlow={!isSealed && !editById}
        />
      );
      default: return null;
    }
  };

  // ── Loading ───────────────────────────────────────────────────────────────

  if (loadingData) {
    return (
      <div className="flex h-[100dvh] w-full flex-col items-center justify-center gap-4 bg-background text-muted-foreground">
        <Loader2 className="h-9 w-9 animate-spin" />
        <span className="text-base">Cargando revisión…</span>
      </div>
    );
  }

  // ── Render ────────────────────────────────────────────────────────────────

  return (
    <>
      {/* ── Modify-reason modal ── */}
      {showModifyModal && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4"
          onClick={() => setShowModifyModal(false)}
        >
          <div
            className="w-full max-w-md rounded-xl border border-border bg-card p-7 shadow-xl"
            onClick={e => e.stopPropagation()}
          >
            <h3 className="mb-2 text-xl font-semibold">Modificar inspección enviada</h3>
            <p className="mb-5 text-sm leading-relaxed text-muted-foreground">
              Este reporte ya fue enviado. Cualquier cambio queda registrado en el historial de auditoría con tu nombre, hora exacta y el motivo.
            </p>
            <label className="mb-1 block text-sm font-medium text-muted-foreground">
              Motivo de la modificación{' '}
              <span className="text-red-600">*</span>
            </label>
            <textarea
              className="input-box w-full text-base"
              placeholder="Ej: Error en el kilometraje registrado por el guardia de turno."
              rows={3}
              value={modifyReason}
              onChange={e => setModifyReason(e.target.value)}
              autoFocus
            />
            <div className="mt-5 flex gap-3">
              <Button
                variant="outline" size="touch"
                className="flex-1 text-base"
                onClick={() => setShowModifyModal(false)}
              >
                Cancelar
              </Button>
              <Button
                size="touch"
                className="flex-1 text-base"
                disabled={!modifyReason.trim() || saving}
                onClick={() => {
                  if (!modifyReason.trim()) return;
                  setShowModifyModal(false);
                  doSave({ ...buildData(), modificationReason: modifyReason });
                }}
              >
                {saving ? (
                  <><Loader2 className="h-5 w-5 animate-spin" /> Guardando…</>
                ) : (
                  'Guardar modificación'
                )}
              </Button>
            </div>
          </div>
        </div>
      )}

      {kmModal && (
        <KmModal
          warning={kmModal}
          onClose={() => setKmModal(null)}
          onConfirm={handleKmConfirm}
        />
      )}

      <div className="flex h-[100dvh] w-full flex-col overflow-hidden bg-background text-foreground">

        {/* ── Header ── */}
        <header className="flex-shrink-0 border-b border-border bg-card">
          <div className="flex items-center gap-4 px-6 py-4">
            <Button variant="outline" size="sm" className="h-10 shrink-0" onClick={handleBack} disabled={saving}>
              <ChevronLeft className="h-4 w-4" />
              Panel
            </Button>
            <div className="flex flex-1 items-baseline justify-center gap-3 overflow-hidden">
              <span className="font-mono text-2xl font-bold tracking-wider">{card.plate}</span>
              <span className="hidden truncate text-sm text-muted-foreground sm:inline">
                {card.vehicleType} {card.brand} {card.model}
              </span>
            </div>
            <span className="shrink-0 font-mono text-sm text-muted-foreground">
              {step + 1}/{total}
            </span>
          </div>

          {/* Step chips — 4 visual states */}
          <div className="flex items-center gap-1 overflow-x-auto px-6 pb-4">
            {BLOCKS.map((b, i) => {
              const isActive    = i === step;
              const wasVisited  = visitedSteps.has(i) && !isActive;
              const answered    = wasVisited && blockHasData(i);
              const needsAnswer = wasVisited && !blockHasData(i);

              return (
                <React.Fragment key={b.k}>
                  <button
                    onClick={() => setStep(i)}
                    title={b.t}
                    className={cn(
                      'step-chip shrink-0',
                      isActive     && '!bg-primary !border-primary !text-primary-foreground',
                      answered     && '!bg-emerald-100 !border-emerald-500 !text-emerald-700',
                      needsAnswer  && '!bg-amber-100 !border-amber-400 !text-amber-700',
                      !isActive && !wasVisited && '!border-border !bg-background !text-muted-foreground',
                    )}
                  >
                    {answered ? '✓' : needsAnswer ? '!' : b.k}
                  </button>
                  {i < BLOCKS.length - 1 && (
                    <div className={cn(
                      'h-0.5 max-w-3 flex-1',
                      answered ? 'bg-emerald-400' : 'bg-border',
                    )} />
                  )}
                </React.Fragment>
              );
            })}
          </div>
        </header>

        {/* ── Context banners ── */}
        {isSealed && !canModify && (
          <div className="mx-6 mt-4 flex shrink-0 items-start gap-3 rounded-lg border border-amber-200 bg-amber-50 px-5 py-3">
            <div>
              <p className="text-sm font-semibold text-amber-800">Turno cerrado — solo lectura</p>
              <p className="mt-0.5 text-xs text-amber-700">
                Solo un supervisor puede modificar una inspección de un turno ya cerrado.
              </p>
            </div>
          </div>
        )}
        {isSealed && canModify && (
          <div className="mx-6 mt-4 flex shrink-0 items-start gap-3 rounded-lg border border-red-200 bg-red-50 px-5 py-3">
            <AlertTriangle className="mt-0.5 h-5 w-5 shrink-0 text-red-600" />
            <div>
              <p className="text-sm font-semibold text-red-800">Modo edición — turno ya cerrado</p>
              <p className="mt-0.5 text-xs text-red-700">
                Cualquier cambio quedará en el historial de auditoría con tu nombre y el motivo.
              </p>
            </div>
          </div>
        )}

        {/* ── Block content ── */}
        <div className="flex flex-1 justify-center overflow-auto py-6">
          <div
            key={step}
            className="w-full max-w-3xl px-6 animate-[modalIn_.22s_var(--press)]"
          >
            <div className="mb-5 flex items-baseline gap-3">
              <span className="font-mono text-lg font-bold text-muted-foreground">
                {BLOCKS[step].k}
              </span>
              <h2 className="m-0 text-2xl font-semibold">{BLOCKS[step].t}</h2>
            </div>
            <div className="rounded-xl border border-border bg-card p-6 shadow-sm">
              {renderBlock()}
            </div>
          </div>
        </div>

        {/* ── Footer ── */}
        <footer className="flex shrink-0 items-center gap-4 border-t border-border bg-muted/40 px-6 py-4">
          <Button
            variant="outline" size="sm"
            className="h-10 shrink-0"
            disabled={step === 0}
            onClick={() => setStep(s => Math.max(0, s - 1))}
          >
            <ChevronLeft className="h-4 w-4" />
            <span className="hidden sm:inline">Anterior</span>
          </Button>

          <div className="flex-1">
            <p className="mb-1.5 font-mono text-xs text-muted-foreground">{Math.round(pct)}%</p>
            <div className="h-2.5 overflow-hidden rounded-full bg-secondary">
              <div
                className="h-full rounded-full bg-primary transition-all duration-500"
                style={{ width: `${pct}%` }}
              />
            </div>
          </div>

          {/* Guardia: "Guardar borrador" es secundario en pasos intermedios.
              En el último paso pasa a ser la acción principal (abajo). */}
          {!readOnly && !isSealed && !editById && !isLastStep && (
            <Button
              size="touch" variant="outline"
              className="shrink-0 text-base"
              onClick={saveDraftAndExit}
              disabled={saving}
            >
              Guardar borrador
            </Button>
          )}

          {readOnly ? (
            <Button size="touch" variant="outline" className="shrink-0 text-base opacity-60" disabled>
              Solo lectura
            </Button>
          ) : isLastStep ? (
            (isSealed || editById) ? (
              // Edición de supervisor (sellada o por id): persiste de inmediato.
              <Button size="touch" className="shrink-0 text-base" onClick={handleSave} disabled={saving}>
                {saving ? (
                  <><Loader2 className="h-5 w-5 animate-spin" /> Guardando…</>
                ) : isSealed ? (
                  '✓ Guardar modificación'
                ) : (
                  '✓ Guardar'
                )}
              </Button>
            ) : (
              // Guardia: NO se finaliza desde el formulario. Solo se guarda el
              // borrador; el envío del reporte se hace con "Enviar" en el panel.
              <Button size="touch" className="shrink-0 text-base" onClick={saveDraftAndExit} disabled={saving}>
                {saving ? (
                  <><Loader2 className="h-5 w-5 animate-spin" /> Guardando…</>
                ) : (
                  'Guardar borrador'
                )}
              </Button>
            )
          ) : (
            <Button
              size="touch"
              className="shrink-0 text-base"
              disabled={!canAdvance()}
              onClick={() => canAdvance() && setStep(s => s + 1)}
            >
              Siguiente
              <ChevronRight className="h-5 w-5" />
            </Button>
          )}
        </footer>
      </div>
    </>
  );
}
