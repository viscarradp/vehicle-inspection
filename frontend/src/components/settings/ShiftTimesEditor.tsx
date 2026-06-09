import { useState } from 'react';
import { Pencil, RotateCcw } from 'lucide-react';
import toast from 'react-hot-toast';
import type { SettingMeta, SettingLevel } from '@/types';
import { SourceBadge } from './SourceBadge';

type ShiftKey = 'shift_morning_start' | 'shift_afternoon_start' | 'shift_night_start';

const SHIFT_LABELS: Record<ShiftKey, string> = {
  shift_morning_start:   'Mañana',
  shift_afternoon_start: 'Tarde',
  shift_night_start:     'Noche',
};

function formatHour(h: number) {
  return `${String(h).padStart(2, '0')}:00`;
}

function validateShiftOrder(m: number, a: number, n: number): string | null {
  if (m >= a) return 'El turno Tarde debe comenzar después del turno Mañana.';
  if (a >= n) return 'El turno Noche debe comenzar después del turno Tarde.';
  return null;
}

interface ShiftTimesEditorProps {
  morning:   SettingMeta;
  afternoon: SettingMeta;
  night:     SettingMeta;
  scopeLevel: SettingLevel;
  onSave:    (updates: Partial<Record<ShiftKey, number | null>>) => Promise<void>;
  isSaving:  boolean;
}

export function ShiftTimesEditor({ morning, afternoon, night, scopeLevel, onSave, isSaving }: ShiftTimesEditorProps) {
  const [editing, setEditing] = useState(false);
  const [draftM, setDraftM]   = useState('');
  const [draftA, setDraftA]   = useState('');
  const [draftN, setDraftN]   = useState('');

  const hasOverride =
    morning.source === scopeLevel ||
    afternoon.source === scopeLevel ||
    night.source === scopeLevel;

  function openEdit() {
    setDraftM(String(morning.value));
    setDraftA(String(afternoon.value));
    setDraftN(String(night.value));
    setEditing(true);
  }

  function cancelEdit() {
    setEditing(false);
  }

  async function save() {
    const m = Number(draftM);
    const a = Number(draftA);
    const n = Number(draftN);

    if ([m, a, n].some(v => !Number.isInteger(v) || v < 0 || v > 23)) {
      toast.error('Cada turno debe ser un valor entre 0 y 23.');
      return;
    }
    const orderErr = validateShiftOrder(m, a, n);
    if (orderErr) {
      toast.error(orderErr);
      return;
    }

    // Solo incluir las keys que cambiaron; null = "sin cambio" NO se envía
    const updates: Partial<Record<ShiftKey, number | null>> = {};
    if (m !== (morning.value as number))   updates.shift_morning_start   = m;
    if (a !== (afternoon.value as number)) updates.shift_afternoon_start = a;
    if (n !== (night.value as number))     updates.shift_night_start     = n;

    if (Object.keys(updates).length === 0) {
      setEditing(false);
      return;
    }

    await onSave(updates);
    setEditing(false);
  }

  async function resetAll() {
    await onSave({
      shift_morning_start:   null,
      shift_afternoon_start: null,
      shift_night_start:     null,
    });
  }

  const metas: [ShiftKey, SettingMeta][] = [
    ['shift_morning_start',   morning],
    ['shift_afternoon_start', afternoon],
    ['shift_night_start',     night],
  ];

  if (!editing) {
    return (
      <div className="px-6 py-4">
        <div className="flex items-start gap-6">
          {/* Visualización de los 3 turnos */}
          <div className="flex flex-1 gap-8">
            {metas.map(([key, meta]) => (
              <div key={key} className="flex flex-col gap-1">
                <span className="text-xs text-muted-foreground">{SHIFT_LABELS[key]}</span>
                <div className="flex items-center gap-2">
                  <span className="text-lg font-semibold tabular-nums">
                    {formatHour(meta.value as number)}
                  </span>
                  <SourceBadge source={meta.source} />
                </div>
              </div>
            ))}
          </div>

          {/* Acciones */}
          <div className="flex items-center gap-2 shrink-0">
            {hasOverride && (
              <button
                onClick={resetAll}
                disabled={isSaving}
                title="Restablecer horarios al valor heredado"
                className="flex items-center gap-1.5 rounded-md border border-border px-3 py-1.5 text-xs text-muted-foreground hover:bg-muted disabled:opacity-40"
              >
                <RotateCcw className="h-3.5 w-3.5" />
                Restablecer
              </button>
            )}
            {(morning.canEdit || afternoon.canEdit || night.canEdit) && (
              <button
                onClick={openEdit}
                disabled={isSaving}
                className="flex items-center gap-1.5 rounded-md border border-border px-3 py-1.5 text-xs hover:bg-muted disabled:opacity-40"
              >
                <Pencil className="h-3.5 w-3.5" />
                Editar horarios
              </button>
            )}
            {!morning.canEdit && (
              <span className="text-xs text-muted-foreground">Uniforme en todo el país</span>
            )}
          </div>
        </div>
      </div>
    );
  }

  // Modo edición
  const fields: { key: ShiftKey; draft: string; setDraft: (v: string) => void }[] = [
    { key: 'shift_morning_start',   draft: draftM, setDraft: setDraftM },
    { key: 'shift_afternoon_start', draft: draftA, setDraft: setDraftA },
    { key: 'shift_night_start',     draft: draftN, setDraft: setDraftN },
  ];

  return (
    <div className="px-6 py-4">
      <div className="flex flex-wrap items-end gap-6">
        {fields.map(({ key, draft, setDraft }) => (
          <div key={key} className="flex flex-col gap-1">
            <label className="text-xs text-muted-foreground">{SHIFT_LABELS[key]}</label>
            <div className="flex items-center gap-1.5">
              <input
                type="number"
                value={draft}
                onChange={e => setDraft(e.target.value)}
                min={0}
                max={23}
                className="input-box w-20 text-right tabular-nums"
              />
              <span className="text-xs text-muted-foreground">h</span>
            </div>
          </div>
        ))}

        <div className="flex items-center gap-2 pb-0.5">
          <button
            onClick={save}
            disabled={isSaving}
            className="rounded-md bg-brand px-4 py-2 text-sm text-white hover:bg-brand/90 disabled:opacity-50"
          >
            {isSaving ? 'Guardando…' : 'Guardar horarios'}
          </button>
          <button
            onClick={cancelEdit}
            disabled={isSaving}
            className="rounded-md border border-border px-4 py-2 text-sm hover:bg-muted disabled:opacity-50"
          >
            Cancelar
          </button>
        </div>
      </div>
      <p className="mt-3 text-xs text-muted-foreground">
        Valores de 0 a 23 horas. El turno de la tarde debe comenzar después del de mañana, y el de noche después del de tarde.
      </p>
    </div>
  );
}
