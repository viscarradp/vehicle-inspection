import { Badge } from '@/components/ui/badge';
import { cn } from '@/lib/utils';
import type { InspectionStatus, VehicleStatusType } from '@/types';

/**
 * Mapa único de estado -> color. El backend decide el `inspectionStatus`;
 * el front solo lo pinta. Cada estado lleva color de fondo/texto/borde
 * y un color de "acento" para el borde izquierdo de la tarjeta, de modo
 * que el estado se reconozca también sin depender solo del matiz.
 */
export interface StatusStyle {
  label: string;
  badge: string; // clases para el Badge
  accent: string; // clase border-l-* para la tarjeta
  dot: string; // color del punto indicador
}

export const STATUS_STYLES: Record<string, StatusStyle> = {
  pending: {
    label: 'Pendiente',
    badge: 'bg-slate-100 text-slate-700 border-slate-300',
    accent: 'border-l-slate-400',
    dot: 'bg-slate-500',
  },
  active: {
    label: 'En circulación',
    badge: 'bg-slate-100 text-slate-700 border-slate-300',
    accent: 'border-l-slate-400',
    dot: 'bg-slate-500',
  },
  reviewed_ok: {
    label: 'Sin novedad',
    badge: 'bg-emerald-100 text-emerald-800 border-emerald-300',
    accent: 'border-l-emerald-500',
    dot: 'bg-emerald-600',
  },
  reviewed_observation: {
    label: 'Con observaciones',
    badge: 'bg-amber-100 text-amber-800 border-amber-300',
    accent: 'border-l-amber-500',
    dot: 'bg-amber-600',
  },
  serious_issue: {
    label: 'Daño / faltante',
    badge: 'bg-red-100 text-red-800 border-red-300',
    accent: 'border-l-red-500',
    dot: 'bg-red-600',
  },
  not_returned: {
    label: 'No retornó',
    badge: 'bg-orange-100 text-orange-800 border-orange-300',
    accent: 'border-l-orange-500',
    dot: 'bg-orange-600',
  },
  workshop: {
    label: 'En taller',
    badge: 'bg-blue-100 text-blue-800 border-blue-300',
    accent: 'border-l-blue-500',
    dot: 'bg-blue-600',
  },
  night_service: {
    label: 'Serv. nocturno',
    badge: 'bg-violet-100 text-violet-800 border-violet-300',
    accent: 'border-l-violet-500',
    dot: 'bg-violet-600',
  },
  abroad: {
    label: 'Fuera del país',
    badge: 'bg-indigo-100 text-indigo-800 border-indigo-300',
    accent: 'border-l-indigo-500',
    dot: 'bg-indigo-600',
  },
  special_authorization: {
    label: 'Autorización especial',
    badge: 'bg-cyan-100 text-cyan-800 border-cyan-300',
    accent: 'border-l-cyan-500',
    dot: 'bg-cyan-600',
  },
  other: {
    label: 'Otro motivo',
    badge: 'bg-zinc-200 text-zinc-800 border-zinc-400',
    accent: 'border-l-zinc-500',
    dot: 'bg-zinc-600',
  },
};

export function getStatusStyle(status: InspectionStatus | string): StatusStyle {
  return STATUS_STYLES[status] ?? STATUS_STYLES.pending;
}

// ─── Paleta de colores para tipos de estado dinámicos ─────────────────────────
// Las clases están aquí como literales para que Tailwind las incluya en el build.

export const COLOR_PALETTE: Record<string, Omit<StatusStyle, 'label'>> = {
  blue:    { badge: 'bg-blue-100 text-blue-800 border-blue-300',       accent: 'border-l-blue-500',    dot: 'bg-blue-600' },
  violet:  { badge: 'bg-violet-100 text-violet-800 border-violet-300', accent: 'border-l-violet-500',  dot: 'bg-violet-600' },
  indigo:  { badge: 'bg-indigo-100 text-indigo-800 border-indigo-300', accent: 'border-l-indigo-500',  dot: 'bg-indigo-600' },
  cyan:    { badge: 'bg-cyan-100 text-cyan-800 border-cyan-300',       accent: 'border-l-cyan-500',    dot: 'bg-cyan-600' },
  orange:  { badge: 'bg-orange-100 text-orange-800 border-orange-300', accent: 'border-l-orange-500',  dot: 'bg-orange-600' },
  amber:   { badge: 'bg-amber-100 text-amber-800 border-amber-300',    accent: 'border-l-amber-500',   dot: 'bg-amber-600' },
  emerald: { badge: 'bg-emerald-100 text-emerald-800 border-emerald-300', accent: 'border-l-emerald-500', dot: 'bg-emerald-600' },
  red:     { badge: 'bg-red-100 text-red-800 border-red-300',           accent: 'border-l-red-500',    dot: 'bg-red-600' },
  slate:   { badge: 'bg-slate-100 text-slate-700 border-slate-300',    accent: 'border-l-slate-400',   dot: 'bg-slate-500' },
};

export const VALID_COLORS = Object.keys(COLOR_PALETTE) as string[];

/** Resuelve el estilo para un estado de vehículo dinámico.
 *  Busca en la lista de tipos primero; si no, cae en STATUS_STYLES (sistema). */
export function getVehicleStatusStyle(key: string, types: VehicleStatusType[]): StatusStyle {
  const type = types.find(t => t.key === key);
  if (type) {
    const palette = COLOR_PALETTE[type.color] ?? COLOR_PALETTE.slate;
    return { label: type.labelEs, ...palette };
  }
  return STATUS_STYLES[key] ?? STATUS_STYLES.pending;
}

interface StatusBadgeProps {
  status: InspectionStatus | string;
  /** Pasar para estados de vehículo dinámicos (VehicleStatusTypes). */
  statusTypes?: VehicleStatusType[];
  className?: string;
}

export function StatusBadge({ status, statusTypes, className }: StatusBadgeProps) {
  const s = statusTypes
    ? getVehicleStatusStyle(status, statusTypes)
    : getStatusStyle(status);
  return (
    <Badge variant="outline" className={cn(s.badge, className)}>
      <span className={cn('h-2 w-2 rounded-full', s.dot)} aria-hidden />
      {s.label}
    </Badge>
  );
}
