import { ArrowRight, Check, AlertTriangle, RotateCcw, MinusCircle, HelpCircle } from 'lucide-react';

import { Card } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { StatusBadge, getStatusStyle, getVehicleStatusStyle } from '@/components/StatusBadge';
import { cn } from '@/lib/utils';
import type { VehicleDashboardCard, VehicleStatusType } from '@/types';

function lastReviewLabel(card: VehicleDashboardCard): string {
  const days =
    card.daysSinceLastReview ??
    (card.lastInspectionDate
      ? Math.floor((Date.now() - new Date(card.lastInspectionDate).getTime()) / 86_400_000)
      : undefined);
  if (days === undefined) return '— / —';
  if (days <= 0) return 'hoy';
  if (days === 1) return 'ayer';
  return `hace ${days} días`;
}

interface Props {
  card: VehicleDashboardCard;
  statusTypes: VehicleStatusType[];
  justRevisado?: boolean;
  onInspeccionar:  () => void;
  onEstadoEspecial: () => void;
  onNoSalio:        () => void;
}

export function VehicleCard({ card, statusTypes, justRevisado, onInspeccionar, onEstadoEspecial, onNoSalio }: Props) {
  const { todayRecord, currentStatus } = card;
  const isAbsent    = currentStatus !== 'active';
  const kind        = todayRecord.kind;

  // Estilo del badge/banner principal
  const headerStyle = isAbsent
    ? getVehicleStatusStyle(currentStatus, statusTypes)
    : kind === 'received'
      ? getStatusStyle(todayRecord.inspectionStatus ?? 'reviewed_ok')
      : getStatusStyle('active');

  return (
    <Card className={cn(
      'relative flex flex-col gap-4 p-6 shadow-sm transition-shadow duration-200 hover:shadow-md',
      justRevisado && 'ring-2 ring-emerald-500 ring-offset-2',
    )}>

      {/* ── Encabezado: placa + badge ── */}
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="font-mono text-3xl font-bold leading-none tracking-tight tabular-nums">
            {card.plate}
          </div>
          <div className="mt-1.5 truncate text-base text-muted-foreground">
            {card.vehicleType}{card.brand ? ` · ${card.brand}` : ''}
          </div>
        </div>

        {isAbsent ? (
          <StatusBadge status={currentStatus} statusTypes={statusTypes} className="shrink-0" />
        ) : kind === 'received' ? (
          <StatusBadge status={todayRecord.inspectionStatus ?? 'reviewed_ok'} className="shrink-0" />
        ) : kind === 'never_left' ? (
          <span className="shrink-0 rounded-full border border-slate-300 bg-slate-50 px-3 py-1 text-xs font-semibold text-slate-500">
            No salió hoy
          </span>
        ) : kind === 'not_returned' ? (
          <span className="shrink-0 rounded-full border border-orange-200 bg-orange-50 px-3 py-1 text-xs font-semibold text-orange-700">
            No retornó
          </span>
        ) : kind === 'other' ? (
          <span className="shrink-0 rounded-full border border-zinc-300 bg-zinc-50 px-3 py-1 text-xs font-semibold text-zinc-600">
            Otro motivo
          </span>
        ) : (
          <span className="shrink-0 rounded-full border border-slate-300 bg-slate-50 px-3 py-1 text-xs font-semibold text-slate-600">
            Sin registrar
          </span>
        )}
      </div>

      {/* ── Banner de estado persistente ── */}
      {isAbsent && (
        <div className={cn('flex items-center gap-2 rounded-md border px-3 py-2 text-sm font-medium', headerStyle.badge)}>
          <RotateCcw className="h-3.5 w-3.5 shrink-0" />
          Estado fijo del vehículo
          {card.currentStatusExpectedReturn && (
            <span className="ml-auto font-mono text-xs opacity-80">
              ret. {card.currentStatusExpectedReturn.split('T')[0]}
            </span>
          )}
        </div>
      )}

      {/* ── Banner "no salió hoy" ── */}
      {!isAbsent && kind === 'never_left' && (
        <div className="flex items-center gap-2 rounded-md border border-slate-200 bg-slate-50 px-3 py-2 text-sm text-slate-600">
          <MinusCircle className="h-3.5 w-3.5 shrink-0" />
          Sin actividad registrada hoy. El vehículo sigue activo mañana.
        </div>
      )}

      {/* ── Banner "no retornó / otro" ── */}
      {!isAbsent && (kind === 'not_returned' || kind === 'other') && (
        <div className="flex items-center gap-2 rounded-md border border-orange-200 bg-orange-50 px-3 py-2 text-sm text-orange-700">
          <HelpCircle className="h-3.5 w-3.5 shrink-0" />
          {kind === 'not_returned' ? 'Marcado como no retornado hoy.' : 'Registrado con otro motivo hoy.'}
        </div>
      )}

      {/* ── Aviso de daño abierto ── */}
      {card.hasOpenIssues && (
        <div className="flex items-center gap-2 rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm font-semibold text-red-700">
          <AlertTriangle className="h-4 w-4" />
          Daño abierto pendiente
        </div>
      )}

      {/* ── Meta: última revisión ── */}
      <div className="flex items-baseline justify-between border-t border-border pt-3 text-sm">
        <span className="text-muted-foreground">Última inspección</span>
        <span className={cn('font-mono font-semibold tabular-nums', card.noReviewAlert ? 'text-red-600' : 'text-foreground')}>
          {lastReviewLabel(card)}
        </span>
      </div>

      {/* ── Acciones ── */}
      <div className="mt-auto flex flex-col gap-2">
        {isAbsent ? (
          <>
            <Button size="touch" className="w-full" onClick={onInspeccionar}>
              Ya regresó — Inspeccionar
              <ArrowRight className="h-5 w-5" />
            </Button>
            <Button size="touch" variant="outline" className="w-full text-base" onClick={onEstadoEspecial}>
              Cambiar estado
            </Button>
          </>
        ) : kind === 'received' ? (
          <Button size="touch" variant="outline" className="w-full text-base" onClick={onInspeccionar}>
            <Check className="h-5 w-5 text-emerald-600" />
            Registrado hoy
          </Button>
        ) : kind === 'never_left' ? (
          // Llegó después de todo, o el guardia se equivocó — sobreescribe el never_left
          <Button size="touch" className="w-full" onClick={onInspeccionar}>
            Llegó — Inspeccionar
            <ArrowRight className="h-5 w-5" />
          </Button>
        ) : kind === 'not_returned' || kind === 'other' ? (
          // Permite corregir el registro del día
          <Button size="touch" variant="outline" className="w-full text-base" onClick={onInspeccionar}>
            Corregir registro
          </Button>
        ) : (
          // kind === 'none' — sin registro aún
          <>
            <Button size="touch" className="w-full" onClick={onInspeccionar}>
              Llegó — Inspeccionar
              <ArrowRight className="h-5 w-5" />
            </Button>
            <div className="grid grid-cols-2 gap-2">
              <Button size="touch" variant="outline" className="w-full text-sm" onClick={onNoSalio}>
                No salió
              </Button>
              <Button size="touch" variant="outline" className="w-full text-sm" onClick={onEstadoEspecial}>
                Estado especial
              </Button>
            </div>
          </>
        )}
      </div>
    </Card>
  );
}
