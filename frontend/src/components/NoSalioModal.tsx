import { useState } from 'react';
import { Loader2 } from 'lucide-react';
import { Button } from '@/components/ui/button';

interface Props {
  plate: string;
  onClose: () => void;
  onConfirm: (note?: string) => Promise<void>;
}

export function NoSalioModal({ plate, onClose, onConfirm }: Props) {
  const [note, setNote]     = useState('');
  const [saving, setSaving] = useState(false);
  const [err, setErr]       = useState('');

  const handleConfirm = async () => {
    setSaving(true);
    setErr('');
    try {
      await onConfirm(note.trim() || undefined);
    } catch {
      setErr('Error al registrar. Intenta de nuevo.');
      setSaving(false);
    }
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4"
      onClick={onClose}
    >
      <div
        className="flex w-full max-w-sm flex-col gap-5 rounded-xl border border-border bg-card p-7 shadow-xl"
        onClick={e => e.stopPropagation()}
      >
        <div>
          <h3 className="text-xl font-semibold">Vehículo no salió</h3>
          <p className="mt-1 text-sm text-muted-foreground">
            Placa{' '}
            <span className="font-mono font-bold text-foreground">{plate}</span>
            {' '}· sin actividad registrada hoy
          </p>
        </div>

        <div>
          <label className="mb-1 block text-sm font-medium text-muted-foreground">
            Observación <span className="font-normal opacity-60">(opcional)</span>
          </label>
          <input
            className="input-line"
            placeholder="Contexto, instrucciones…"
            value={note}
            onChange={e => setNote(e.target.value)}
            autoFocus
          />
        </div>

        <p className="rounded-md bg-muted/60 px-3 py-2 text-xs text-muted-foreground">
          Se registrará como evento del día. El vehículo seguirá activo mañana.
        </p>

        {err && <p className="text-sm font-medium text-red-600">{err}</p>}

        <div className="flex gap-3">
          <Button variant="outline" size="touch" className="flex-1 text-base" onClick={onClose} disabled={saving}>
            Cancelar
          </Button>
          <Button size="touch" className="flex-1 text-base" onClick={handleConfirm} disabled={saving}>
            {saving ? (<><Loader2 className="h-5 w-5 animate-spin" /> Guardando…</>) : ('✓ Confirmar')}
          </Button>
        </div>
      </div>
    </div>
  );
}
