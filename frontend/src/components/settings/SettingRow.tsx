import { useState } from 'react';
import { Pencil, Lock, RotateCcw } from 'lucide-react';
import toast from 'react-hot-toast';
import type { SettingKey, SettingMeta, SettingLevel } from '@/types';
import { SourceBadge } from './SourceBadge';

// ─── Configuración de presentación por clave ───────────────────────────────────

interface KeyConfig {
  label: string;
  min?:  number;
  max?:  number;
  unit?: string;
  selectOptions?: { value: number; label: string }[];
}

const WEEK_DAYS = ['Domingo', 'Lunes', 'Martes', 'Miércoles', 'Jueves', 'Viernes', 'Sábado'];

const KEY_CONFIG: Record<SettingKey, KeyConfig> = {
  unusually_high_mileage_threshold: { label: 'Umbral de km inusual',    min: 1,  max: 9_999,  unit: 'km'   },
  no_review_days_threshold:         { label: 'Alerta sin revisión',     min: 1,  max: 365,    unit: 'días' },
  unseen_alert_hours:               { label: 'Alerta vehículo no visto',min: 1,  max: 168,    unit: 'horas'},
  shift_morning_start:              { label: 'Inicio turno Mañana',     min: 0,  max: 23,     unit: 'h'    },
  shift_afternoon_start:            { label: 'Inicio turno Tarde',      min: 0,  max: 23,     unit: 'h'    },
  shift_night_start:                { label: 'Inicio turno Noche',      min: 0,  max: 23,     unit: 'h'    },
  week_start_day:                   { label: 'Primer día de semana',    selectOptions: WEEK_DAYS.map((d, i) => ({ value: i, label: d })) },
  audit_log_retention_days:         { label: 'Retención de bitácora',   min: 30, max: 3_650,  unit: 'días' },
  max_photo_size_mb:                { label: 'Tamaño máximo de foto',   min: 1,  max: 50,     unit: 'MB'   },
};

function getLockReason(overridableTo: SettingLevel, scopeLevel: SettingLevel): string {
  if (overridableTo === 'global') return 'Uniforme en toda la organización';
  if (overridableTo === 'country' && scopeLevel === 'branch') return 'Uniforme en todo el país';
  return 'No editable en este nivel';
}

// ─── Props ────────────────────────────────────────────────────────────────────

interface SettingRowProps {
  settingKey: SettingKey;
  meta:       SettingMeta;
  scopeLevel: SettingLevel;
  onSave:     (key: SettingKey, value: number | boolean | null) => Promise<void>;
  isSaving:   boolean;
}

// ─── Componente ───────────────────────────────────────────────────────────────

export function SettingRow({ settingKey, meta, scopeLevel, onSave, isSaving }: SettingRowProps) {
  const cfg = KEY_CONFIG[settingKey];
  const isBoolean = typeof meta.value === 'boolean';
  const hasSelect = Boolean(cfg.selectOptions);

  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState('');

  const hasOverrideHere = meta.source === scopeLevel;

  function openEdit() {
    setDraft(String(meta.value));
    setEditing(true);
  }

  function cancelEdit() {
    setEditing(false);
  }

  async function saveNumber() {
    const n = Number(draft);
    if (
      !Number.isInteger(n) ||
      (cfg.min !== undefined && n < cfg.min) ||
      (cfg.max !== undefined && n > cfg.max)
    ) {
      const range =
        cfg.min !== undefined && cfg.max !== undefined
          ? ` (${cfg.min}–${cfg.max}${cfg.unit ? ' ' + cfg.unit : ''})`
          : '';
      toast.error(`${cfg.label}: valor fuera de rango${range}.`);
      return;
    }
    await onSave(settingKey, n);
    setEditing(false);
  }

  async function saveSelect(val: string) {
    await onSave(settingKey, Number(val));
    setEditing(false);
  }

  async function toggleBoolean() {
    await onSave(settingKey, !(meta.value as boolean));
  }

  async function reset() {
    await onSave(settingKey, null);
  }

  // Valor para mostrar en modo lectura
  let displayValue: string;
  if (isBoolean) {
    displayValue = (meta.value as boolean) ? 'Sí' : 'No';
  } else if (cfg.selectOptions) {
    displayValue = cfg.selectOptions.find(o => o.value === meta.value)?.label ?? String(meta.value);
  } else {
    displayValue = `${meta.value}${cfg.unit ? ` ${cfg.unit}` : ''}`;
  }

  return (
    <div className="border-b border-border px-6 py-4 last:border-0">
      <div className="flex items-start gap-4">

        {/* Izquierda: etiqueta + descripción */}
        <div className="flex-1 min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-sm font-medium">{cfg.label}</span>
            <SourceBadge source={meta.source} />
          </div>
          {meta.description && (
            <p className="mt-0.5 text-xs text-muted-foreground">{meta.description}</p>
          )}
        </div>

        {/* Derecha: control */}
        <div className="flex shrink-0 items-center gap-2">
          {!meta.canEdit ? (
            // Bloqueado
            <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
              <Lock className="h-3.5 w-3.5 shrink-0" />
              <span>{getLockReason(meta.overridableTo, scopeLevel)}</span>
              <span className="font-medium text-foreground ml-2">{displayValue}</span>
            </div>

          ) : isBoolean ? (
            // Toggle booleano
            <>
              {hasOverrideHere && (
                <button
                  onClick={reset}
                  disabled={isSaving}
                  title="Restablecer al valor heredado"
                  className="text-muted-foreground hover:text-foreground disabled:opacity-40"
                >
                  <RotateCcw className="h-3.5 w-3.5" />
                </button>
              )}
              <button
                role="switch"
                aria-checked={meta.value as boolean}
                onClick={toggleBoolean}
                disabled={isSaving}
                className={`relative inline-flex h-5 w-9 shrink-0 cursor-pointer items-center rounded-full transition-colors disabled:opacity-50 ${
                  meta.value ? 'bg-brand' : 'bg-slate-300'
                }`}
              >
                <span
                  className={`inline-block h-3.5 w-3.5 transform rounded-full bg-white shadow transition-transform ${
                    meta.value ? 'translate-x-4' : 'translate-x-1'
                  }`}
                />
              </button>
              <span className="w-6 text-right text-sm text-muted-foreground">{displayValue}</span>
            </>

          ) : hasSelect && !editing ? (
            // Select en modo lectura
            <>
              {hasOverrideHere && (
                <button
                  onClick={reset}
                  disabled={isSaving}
                  title="Restablecer al valor heredado"
                  className="text-muted-foreground hover:text-foreground disabled:opacity-40"
                >
                  <RotateCcw className="h-3.5 w-3.5" />
                </button>
              )}
              <span className="min-w-[6rem] text-right text-sm font-medium">{displayValue}</span>
              <button
                onClick={openEdit}
                disabled={isSaving}
                className="text-muted-foreground hover:text-foreground disabled:opacity-40"
              >
                <Pencil className="h-3.5 w-3.5" />
              </button>
            </>

          ) : hasSelect && editing ? (
            // Select en modo edición
            <div className="flex items-center gap-2">
              <select
                value={draft}
                onChange={e => saveSelect(e.target.value)}
                autoFocus
                className="input-box"
              >
                {cfg.selectOptions!.map(o => (
                  <option key={o.value} value={o.value}>{o.label}</option>
                ))}
              </select>
              <button
                onClick={cancelEdit}
                className="rounded-md border border-border px-3 py-1.5 text-xs hover:bg-muted"
              >
                Cancelar
              </button>
            </div>

          ) : !editing ? (
            // Número en modo lectura
            <>
              {hasOverrideHere && (
                <button
                  onClick={reset}
                  disabled={isSaving}
                  title="Restablecer al valor heredado"
                  className="text-muted-foreground hover:text-foreground disabled:opacity-40"
                >
                  <RotateCcw className="h-3.5 w-3.5" />
                </button>
              )}
              <span className="min-w-[4rem] text-right text-sm font-medium">{displayValue}</span>
              <button
                onClick={openEdit}
                disabled={isSaving}
                className="text-muted-foreground hover:text-foreground disabled:opacity-40"
              >
                <Pencil className="h-3.5 w-3.5" />
              </button>
            </>

          ) : (
            // Número en modo edición
            <div className="flex items-center gap-2">
              <input
                type="number"
                value={draft}
                onChange={e => setDraft(e.target.value)}
                onKeyDown={e => {
                  if (e.key === 'Enter') saveNumber();
                  if (e.key === 'Escape') cancelEdit();
                }}
                min={cfg.min}
                max={cfg.max}
                autoFocus
                className="input-box w-24 text-right"
              />
              {cfg.unit && <span className="text-xs text-muted-foreground">{cfg.unit}</span>}
              <button
                onClick={saveNumber}
                disabled={isSaving}
                className="rounded-md bg-brand px-3 py-1.5 text-xs text-white hover:bg-brand/90 disabled:opacity-50"
              >
                {isSaving ? '…' : 'Guardar'}
              </button>
              <button
                onClick={cancelEdit}
                disabled={isSaving}
                className="rounded-md border border-border px-3 py-1.5 text-xs hover:bg-muted disabled:opacity-50"
              >
                Cancelar
              </button>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
