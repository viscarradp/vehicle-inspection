import { useState, useRef } from 'react';

interface Props {
  plate: string;
  onClose: () => void;
  onConfirm: (comment: string) => Promise<void>;
}

export function NoRetornadoModal({ plate, onClose, onConfirm }: Props) {
  const [comment, setComment] = useState('');
  const [err, setErr] = useState(false);
  const [saving, setSaving] = useState(false);
  const taRef = useRef<HTMLTextAreaElement>(null);

  const handleConfirm = async () => {
    if (!comment.trim()) { setErr(true); taRef.current?.focus(); return; }
    setSaving(true);
    try { await onConfirm(comment.trim()); }
    finally { setSaving(false); }
  };

  return (
    <div className="modal-back" onClick={onClose}>
      <div className="modal-box" onClick={e => e.stopPropagation()}>
        <h3>Vehículo no retornado</h3>
        <div style={{ color: 'var(--ink-2)', fontSize: 15, marginBottom: 14 }}>
          Vas a registrar que <b className="mono">{plate}</b> no se encuentra en la empresa al momento de la revisión.
        </div>
        <div className="box-soft" style={{ padding: 12, fontSize: 14, color: 'var(--ink-2)', lineHeight: 1.5, marginBottom: 16 }}>
          ⓘ Solo registra la ausencia. El jefe de operaciones revisará los detalles después.
        </div>
        <div style={{ fontSize: 13, color: 'var(--ink-3)', marginBottom: 4 }}>
          Comentario <span style={{ color: 'var(--st-dano-ink)' }}>*</span>
        </div>
        <textarea
          ref={taRef}
          className={`input-box${err ? ' is-error' : ''}`}
          rows={3}
          style={{ resize: 'vertical', fontSize: 15 }}
          placeholder="Ej. salió en la tarde con el ingeniero, no regresó al cierre…"
          value={comment}
          onChange={e => { setComment(e.target.value); setErr(false); }}
        />
        <div style={{ display: 'flex', gap: 10, marginTop: 18 }}>
          <button className="btn" style={{ flex: 1 }} onClick={onClose}>Cancelar</button>
          <button
            className="btn btn-primary"
            style={{ flex: 1 }}
            onClick={handleConfirm}
            disabled={saving}
          >
            {saving ? 'Guardando...' : '✓ Registrar ausencia'}
          </button>
        </div>
      </div>
    </div>
  );
}
