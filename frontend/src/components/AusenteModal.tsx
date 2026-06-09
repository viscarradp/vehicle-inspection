import { useState } from 'react';
import { Loader2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import { COLOR_PALETTE } from '@/components/StatusBadge';
import type { ReturnStatus, VehicleStatusType } from '@/types';

// ─── Opciones de evento puntual (hardcoded — no son VehicleStatusTypes) ────────

interface EventOpt {
  kind: 'event';
  v: ReturnStatus;
  label: string;
  sub: string;
  badgeClass: string;
  dotClass: string;
}

const EVENT_OPTS: EventOpt[] = [
  {
    kind: 'event', v: 'not_returned',
    label: 'No retornó',
    sub: 'Salió pero no regresó (razón desconocida)',
    badgeClass: 'border-orange-200 bg-orange-50 text-orange-800',
    dotClass: 'bg-orange-500',
  },
  {
    kind: 'event', v: 'other',
    label: 'Otro motivo',
    sub: 'Cualquier otra razón justificada',
    badgeClass: 'border-zinc-200 bg-zinc-50 text-zinc-700',
    dotClass: 'bg-zinc-400',
  },
];

// ─── Props ────────────────────────────────────────────────────────────────────

export interface AusenteData {
  kind: 'event' | 'status';
  returnStatus?: ReturnStatus;
  vehicleStatus?: string;
  authorizedBy?: string;
  expectedReturnDate?: string;
  note?: string;
}

interface Props {
  plate: string;
  statusTypes: VehicleStatusType[];
  onClose: () => void;
  onConfirm: (data: AusenteData) => Promise<void>;
}

type Selection =
  | { kind: 'event'; opt: EventOpt }
  | { kind: 'status'; type: VehicleStatusType };

// ─── Component ───────────────────────────────────────────────────────────────

export function AusenteModal({ plate, statusTypes, onClose, onConfirm }: Props) {
  const [selected, setSelected]         = useState<Selection | null>(null);
  const [authBy, setAuthBy]             = useState('');
  const [expectedDate, setExpectedDate] = useState('');
  const [note, setNote]                 = useState('');
  const [saving, setSaving]             = useState(false);
  const [err, setErr]                   = useState('');

  const selectedKey = selected?.kind === 'event' ? selected.opt.v : selected?.type.key;
  const needsAuth   = selectedKey === 'special_authorization';
  const isStatus    = selected?.kind === 'status';

  const handleConfirm = async () => {
    if (!selected) { setErr('Selecciona el motivo.'); return; }
    setSaving(true); setErr('');
    try {
      await onConfirm(
        selected.kind === 'event'
          ? { kind: 'event', returnStatus: selected.opt.v, authorizedBy: authBy.trim() || undefined, note: note.trim() || undefined }
          : { kind: 'status', vehicleStatus: selected.type.key, authorizedBy: authBy.trim() || undefined, expectedReturnDate: expectedDate || undefined, note: note.trim() || undefined }
      );
    } catch {
      setErr('Error al registrar. Intenta de nuevo.');
      setSaving(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4" onClick={onClose}>
      <div className="flex w-full max-w-lg flex-col gap-5 rounded-xl border border-border bg-card p-7 shadow-xl" onClick={e => e.stopPropagation()}>

        <div>
          <h3 className="text-xl font-semibold">Estado especial del vehículo</h3>
          <p className="mt-1 text-sm text-muted-foreground">
            Placa <span className="font-mono font-bold text-foreground">{plate}</span>
            {' '}· elige el estado o motivo de ausencia
          </p>
        </div>

        {/* ── Estados persistentes (dinámicos) ── */}
        {statusTypes.length > 0 && (
          <div>
            <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">Estado fijo del vehículo</p>
            <div className="grid grid-cols-2 gap-2">
              {statusTypes.map(t => {
                const palette = COLOR_PALETTE[t.color] ?? COLOR_PALETTE.slate;
                const isSelected = selected?.kind === 'status' && selected.type.key === t.key;
                return (
                  <button
                    key={t.key}
                    onClick={() => { setSelected({ kind: 'status', type: t }); setErr(''); }}
                    className={cn(
                      'flex items-start gap-3 rounded-lg border-2 p-4 text-left transition-all',
                      isSelected ? `${palette.badge} border-opacity-80` : 'border-border bg-background hover:bg-muted',
                    )}
                  >
                    <span className={cn('mt-0.5 h-3 w-3 shrink-0 rounded-full', palette.dot)} />
                    <div className="min-w-0">
                      <p className={cn('text-sm font-semibold leading-tight', isSelected ? '' : 'text-foreground')}>{t.labelEs}</p>
                      <p className={cn('mt-0.5 text-xs leading-tight', isSelected ? 'opacity-80' : 'text-muted-foreground')}>Persistente</p>
                    </div>
                  </button>
                );
              })}
            </div>
          </div>
        )}

        {/* ── Eventos puntuales (hardcoded) ── */}
        <div>
          <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">Evento del día</p>
          <div className="grid grid-cols-2 gap-2">
            {EVENT_OPTS.map(o => {
              const isSelected = selected?.kind === 'event' && selected.opt.v === o.v;
              return (
                <button
                  key={o.v}
                  onClick={() => { setSelected({ kind: 'event', opt: o }); setErr(''); }}
                  className={cn(
                    'flex items-start gap-3 rounded-lg border-2 p-4 text-left transition-all',
                    isSelected ? `${o.badgeClass} border-opacity-80` : 'border-border bg-background hover:bg-muted',
                  )}
                >
                  <span className={cn('mt-0.5 h-3 w-3 shrink-0 rounded-full', o.dotClass)} />
                  <div className="min-w-0">
                    <p className={cn('text-sm font-semibold leading-tight', isSelected ? '' : 'text-foreground')}>{o.label}</p>
                    <p className={cn('mt-0.5 text-xs leading-tight', isSelected ? 'opacity-80' : 'text-muted-foreground')}>{o.sub}</p>
                  </div>
                </button>
              );
            })}
          </div>
        </div>

        {/* ── Campos condicionales ── */}
        {needsAuth && (
          <div className="grid gap-4 rounded-lg border border-border bg-muted/40 p-4 sm:grid-cols-2">
            <div>
              <label className="mb-1 block text-sm font-medium text-muted-foreground">Persona que autorizó</label>
              <input className="input-line" placeholder="Nombre y cargo…" value={authBy} onChange={e => setAuthBy(e.target.value)} autoFocus />
            </div>
            <div>
              <label className="mb-1 block text-sm font-medium text-muted-foreground">Fecha estimada de retorno</label>
              <input type="date" className="input-box w-full" value={expectedDate} onChange={e => setExpectedDate(e.target.value)} />
            </div>
          </div>
        )}

        {selected && (
          <div>
            <label className="mb-1 block text-sm font-medium text-muted-foreground">
              Observación <span className="font-normal opacity-60">(opcional)</span>
            </label>
            <input className="input-line" placeholder="Contexto, instrucciones…" value={note} onChange={e => setNote(e.target.value)} />
          </div>
        )}

        {isStatus && (
          <p className="rounded-md bg-muted/60 px-3 py-2 text-xs text-muted-foreground">
            Este estado quedará fijo en el vehículo hasta que se reciba físicamente o se cambie. No hace falta repetirlo cada día.
          </p>
        )}

        {err && <p className="text-sm font-medium text-red-600">{err}</p>}

        <div className="flex gap-3">
          <Button variant="outline" size="touch" className="flex-1 text-base" onClick={onClose} disabled={saving}>Cancelar</Button>
          <Button size="touch" className="flex-1 text-base" onClick={handleConfirm} disabled={!selected || saving}>
            {saving ? (<><Loader2 className="h-5 w-5 animate-spin" /> Guardando…</>) : ('✓ Registrar')}
          </Button>
        </div>
      </div>
    </div>
  );
}
