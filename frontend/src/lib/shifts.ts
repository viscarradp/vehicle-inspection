/** Etiquetas en español — solo presentación; el turno real lo define el servidor. */
export const SHIFT_LABELS: Record<string, string> = {
  morning: 'Mañana',
  afternoon: 'Tarde',
  night: 'Noche',
};

export function shiftLabel(shift: string): string {
  return SHIFT_LABELS[shift] ?? shift;
}

/** Aproximación local para mostrar en login (el servidor puede diferir por sucursal). */
export function guessClientShift(): string {
  const h = new Date().getHours();
  if (h >= 6 && h < 14) return 'morning';
  if (h >= 14 && h < 22) return 'afternoon';
  return 'night';
}

export const SHIFT_HOURS_HINT: Record<string, string> = {
  morning: '06:00 – 13:59',
  afternoon: '14:00 – 21:59',
  night: '22:00 – 05:59',
};
