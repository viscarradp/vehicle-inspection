import { useState } from 'react';
import { MileageWarning } from '../types';

interface Props {
  warning: MileageWarning;
  onClose: () => void;
  onConfirm: (justification: string) => void;
}

export function KmModal({ warning, onClose, onConfirm }: Props) {
  const [confirming, setConfirming] = useState(false);
  const [text, setText] = useState('');
  const [err, setErr] = useState(false);

  const isLower = warning.warningType === 'lower_than_previous';

  const handleConfirm = () => {
    if (!text.trim()) { setErr(true); return; }
    onConfirm(text.trim());
  };

  return (
    <div className="modal-back" onClick={onClose}>
      <div className="modal-box" onClick={e => e.stopPropagation()}>
        <h3>⚠ Verifica el kilometraje</h3>
        <div style={{ color: 'var(--ink-2)', fontSize: 15, marginBottom: 16 }}>
          {isLower
            ? 'El kilometraje ingresado es menor al último registrado.'
            : 'El kilometraje parece inusualmente alto.'}
        </div>

        <div className="modal-row">
          <span>Último registrado</span>
          <span className="mnum mono">{warning.previousMileage.toLocaleString('es-GT')} km</span>
        </div>
        <div className="modal-row">
          <span>Ingresado ahora</span>
          <span className="mnum mono" style={{ color: 'var(--st-dano-ink)' }}>{warning.newMileage.toLocaleString('es-GT')} km</span>
        </div>
        <div className="modal-row">
          <span>Diferencia</span>
          <span className="mnum mono" style={{ color: 'var(--st-dano-ink)' }}>
            {warning.difference > 0 ? '+' : ''}{warning.difference.toLocaleString('es-GT')} km
          </span>
        </div>

        {confirming && (
          <div style={{ marginTop: 16, animation: 'modalIn .2s var(--press)' }}>
            <div className="field-label">Justificación <span style={{ color: 'var(--st-dano-ink)' }}>*</span></div>
            <input
              className={`input-line${err ? ' is-error' : ''}`}
              style={{ fontSize: 17 }}
              placeholder="Ej. odómetro reparado en taller…"
              value={text}
              onChange={e => { setText(e.target.value); setErr(false); }}
              autoFocus
            />
          </div>
        )}

        <div style={{ display: 'flex', gap: 10, marginTop: 20 }}>
          <button className="btn" style={{ flex: 1 }} onClick={onClose}>Corregir</button>
          {!confirming
            ? <button className="btn btn-primary" style={{ flex: 1 }} onClick={() => setConfirming(true)}>Confirmar con justificación</button>
            : <button className="btn btn-primary" style={{ flex: 1 }} onClick={handleConfirm}>Guardar</button>
          }
        </div>
      </div>
    </div>
  );
}
