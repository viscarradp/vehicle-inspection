import { useEffect, useState, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import toast from 'react-hot-toast';
import { Search, LogOut, Loader2, Car } from 'lucide-react';

import { useAuth } from '@/context/AuthContext';
import { VehicleCard } from '../components/VehicleCard';
import { AusenteModal, type AusenteData } from '../components/AusenteModal';
import { NoSalioModal } from '../components/NoSalioModal';
import { useVehicleStatusTypes } from '@/hooks/useVehicleStatusTypes';
import { InspectionForm } from '../components/InspectionForm';
import { InspectionSummaryModal, type InspectionSummary } from '../components/InspectionSummaryModal';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { VehicleDashboardCard, GuardDashboard, InspectionFormData, Driver } from '../types';
import { inspectionApi, vehicleApi, driverApi } from '../api/endpoints';

type FilterKey = 'todos' | 'sin_revisar' | 'fuera' | 'revisado';

const FILTER_LABELS: Record<FilterKey, string> = {
  todos:       'Todos',
  sin_revisar: 'Sin revisar',
  fuera:       'Ausentes',
  revisado:    'Revisados',
};

function matchesFilter(card: VehicleDashboardCard, f: FilterKey): boolean {
  if (f === 'todos')       return true;
  if (f === 'sin_revisar') return card.currentStatus === 'active' && card.todayRecord.kind === 'none';
  if (f === 'fuera')       return card.currentStatus !== 'active';
  if (f === 'revisado')    return card.todayRecord.kind !== 'none';
  return false;
}

function countByFilter(vehicles: VehicleDashboardCard[], f: FilterKey): number {
  return vehicles.filter(v => matchesFilter(v, f)).length;
}

/** Orden: sin registrar (activos) → ausentes → con registro hoy */
function sortVehicles(list: VehicleDashboardCard[]): VehicleDashboardCard[] {
  const score = (v: VehicleDashboardCard) => {
    if (v.todayRecord.kind !== 'none') return 3;
    if (v.currentStatus !== 'active')  return 2;
    return 1;
  };
  return [...list].sort((a, b) => score(a) - score(b));
}

export function Dashboard() {
  const { user, logout } = useAuth();
  const navigate = useNavigate();
  const { types: statusTypes } = useVehicleStatusTypes();

  const [dashboard, setDashboard]     = useState<GuardDashboard | null>(null);
  const [loading, setLoading]         = useState(true);
  const [selectedCard, setSelectedCard] = useState<VehicleDashboardCard | null>(null);
  const [ausenteCard, setAusenteCard] = useState<VehicleDashboardCard | null>(null);
  const [noSalioCard, setNoSalioCard] = useState<VehicleDashboardCard | null>(null);
  const [filter, setFilter]           = useState<FilterKey>('todos');
  const [search, setSearch]           = useState('');
  const [justRevisado, setJustRevisado] = useState<string | null>(null);
  const [drivers, setDrivers]         = useState<Driver[]>([]);
  // Modal de resumen: 'send' (confirmar envío de borrador) o 'view' (ver reporte enviado, solo lectura).
  const [summaryModal, setSummaryModal] = useState<{ card: VehicleDashboardCard; insp: Record<string, unknown>; mode: 'send' | 'view' } | null>(null);
  const [enviarSending, setEnviarSending] = useState(false);

  const loadDashboard = useCallback(async () => {
    setLoading(true);
    try {
      const res = await inspectionApi.dashboard();
      const data = res.data.data as GuardDashboard;
      // Normaliza cards por si el servidor devuelve formato pre-todayRecord
      data.vehicles = data.vehicles.map(v =>
        v.todayRecord ? v : { ...v, todayRecord: { kind: 'none' as const } }
      );
      setDashboard(data);
    } catch {
      setDashboard(null);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { loadDashboard(); }, [loadDashboard]);

  // Conductores para resolver el nombre de "quién entrega" en el resumen de envío.
  useEffect(() => {
    driverApi.list().then(r => setDrivers(r.data.data as Driver[])).catch(() => {});
  }, []);

  const vehicles = dashboard?.vehicles ?? [];
  const counts   = dashboard?.counts ?? { total: 0, seen: 0, unseen: 0 };

  const sorted  = sortVehicles(vehicles);
  const visible = sorted.filter(v => {
    if (search && !v.plate.toLowerCase().includes(search.toLowerCase())) return false;
    return matchesFilter(v, filter);
  });

  const markFlash = (plate: string) => {
    setJustRevisado(plate);
    setTimeout(() => setJustRevisado(null), 800);
  };

  const handleSaved = useCallback(() => {
    const plate = selectedCard?.plate ?? null;
    setSelectedCard(null);
    if (plate) markFlash(plate);
    loadDashboard();
  }, [selectedCard, loadDashboard]);

  /** Modal de ausencia: evento puntual (inspección) o estado persistente (vehículo). */
  const handleAusente = async (data: AusenteData) => {
    if (!ausenteCard) return;
    const plate = ausenteCard.plate;
    try {
      if (data.kind === 'status' && data.vehicleStatus) {
        const reason = [data.note, data.authorizedBy ? `Autorizó: ${data.authorizedBy}` : '']
          .filter(Boolean).join(' · ') || undefined;
        await vehicleApi.setStatus(ausenteCard.vehicleId, {
          status: data.vehicleStatus, reason, expectedReturnDate: data.expectedReturnDate,
        });
      } else {
        await inspectionApi.save({
          vehicleId:          ausenteCard.vehicleId,
          plate,
          returnStatus:       data.returnStatus ?? 'other',
          authorizedBy:       data.authorizedBy,
          expectedReturnDate: data.expectedReturnDate,
          generalObservation: data.note,
        });
      }
      setAusenteCard(null);
      markFlash(plate);
      loadDashboard();
      toast.success(`${plate} actualizado.`);
    } catch (err: unknown) {
      const msg = (err as { response?: { data?: { message?: string } } }).response?.data?.message;
      toast.error(msg ?? 'Error al registrar.');
    }
  };

  // Enviar (paso 1): relee la fila borrador y abre el modal de resumen para que
  // el guardia confirme la información antes de finalizar.
  const handleEnviarBorrador = async (card: VehicleDashboardCard) => {
    if (!card.draft) return;
    try {
      const got = await inspectionApi.get(card.draft.inspectionId);
      setSummaryModal({ card, insp: got.data.data as Record<string, unknown>, mode: 'send' });
    } catch (err: unknown) {
      const msg = (err as { response?: { data?: { message?: string } } }).response?.data?.message;
      toast.error(msg ?? 'No se pudo cargar el borrador.');
    }
  };

  // Ver reporte enviado: abre el mismo modal de resumen en modo solo lectura.
  const handleVerReporte = async (card: VehicleDashboardCard) => {
    const id = card.todayRecord.inspectionId;
    if (!id) return;
    try {
      const got = await inspectionApi.get(id);
      setSummaryModal({ card, insp: got.data.data as Record<string, unknown>, mode: 'view' });
    } catch (err: unknown) {
      const msg = (err as { response?: { data?: { message?: string } } }).response?.data?.message;
      toast.error(msg ?? 'No se pudo cargar el reporte.');
    }
  };

  // Enviar (paso 2): confirmado en el modal. Reenvía el borrador con intent:'final',
  // reutilizando toda la validación/creación de issue/refresh de kilometraje del
  // backend (el upsert por bucket encuentra el borrador y lo promueve in-place).
  // Si el borrador está incompleto, el backend responde con el error puntual.
  const confirmEnviar = async () => {
    if (!summaryModal) return;
    const { card, insp } = summaryModal;
    setEnviarSending(true);
    try {
      const body: InspectionFormData = {
        vehicleId:                 card.vehicleId,
        plate:                     card.plate,
        returnStatus:              (insp.returnStatus as InspectionFormData['returnStatus']) ?? 'received',
        finalDriverId:             (insp.finalDriverId as string | undefined) || undefined,
        finalDriverNameManual:     (insp.finalDriverNameManual as string | undefined) || undefined,
        mileage:                   (insp.mileage as number | undefined) ?? undefined,
        fuelLevel:                 insp.fuelLevel as InspectionFormData['fuelLevel'],
        cleanlinessStatus:         insp.cleanlinessStatus as InspectionFormData['cleanlinessStatus'],
        toolsGeneralStatus:        insp.toolsGeneralStatus as InspectionFormData['toolsGeneralStatus'],
        exteriorGeneralStatus:     insp.exteriorGeneralStatus as InspectionFormData['exteriorGeneralStatus'],
        interiorGeneralStatus:     insp.interiorGeneralStatus as InspectionFormData['interiorGeneralStatus'],
        generalObservation:        (insp.generalObservation as string | undefined) || undefined,
        mileageWarningConfirmed:   !!insp.mileageWarningConfirmed,
        mileageWarningObservation: (insp.mileageWarningObservation as string | undefined) || undefined,
        intent:                    'final',
      };
      const res = await inspectionApi.save(body);
      if (res.data.uiState === 'mileage_warning') {
        toast.error('El kilometraje necesita confirmación. Abre "Editar" para revisarlo.');
        setEnviarSending(false);
        setSummaryModal(null);
        return;
      }
      setSummaryModal(null);
      markFlash(card.plate);
      loadDashboard();
      toast.success(
        res.data.uiState === 'open_issue_created'
          ? `${card.plate} — enviado. Daño registrado para seguimiento.`
          : `${card.plate} — reporte enviado.`,
      );
    } catch (err: unknown) {
      const msg = (err as { response?: { data?: { message?: string } } }).response?.data?.message;
      toast.error(msg ?? 'No se pudo enviar. Completa el borrador con "Editar".');
      setSummaryModal(null);
    } finally {
      setEnviarSending(false);
    }
  };

  // Arma el resumen tipado para el modal desde la card + la inspección borrador.
  const toSummary = (card: VehicleDashboardCard, insp: Record<string, unknown>): InspectionSummary => {
    const driverName = insp.finalDriverNameManual
      ? String(insp.finalDriverNameManual)
      : insp.finalDriverId != null
        ? (drivers.find(d => d.id === String(insp.finalDriverId))?.name ?? `Conductor #${insp.finalDriverId}`)
        : undefined;
    return {
      plate:                 card.plate,
      vehicleType:           card.vehicleType,
      brand:                 card.brand,
      model:                 card.model,
      localDate:             insp.localDate as string | undefined,
      shift:                 insp.shift as string | undefined,
      mileage:               insp.mileage as number | undefined,
      previousMileage:       insp.previousMileage as number | undefined,
      mileageDifference:     insp.mileageDifference as number | undefined,
      guardName:             insp.guardName as string | undefined,
      driverName,
      exteriorGeneralStatus: insp.exteriorGeneralStatus as string | undefined,
      interiorGeneralStatus: insp.interiorGeneralStatus as string | undefined,
      toolsGeneralStatus:    insp.toolsGeneralStatus as string | undefined,
      fuelLevel:             insp.fuelLevel as string | undefined,
      cleanlinessStatus:     insp.cleanlinessStatus as string | undefined,
      generalObservation:    insp.generalObservation as string | undefined,
    };
  };

  const handleDescartarBorrador = async (card: VehicleDashboardCard) => {
    if (!card.draft) return;
    if (!window.confirm(`¿Descartar el borrador de ${card.plate}? Esta acción no se puede deshacer.`)) return;
    try {
      await inspectionApi.discard(card.draft.inspectionId);
      toast.success(`Borrador de ${card.plate} descartado.`);
      loadDashboard();
    } catch (err: unknown) {
      const msg = (err as { response?: { data?: { message?: string } } }).response?.data?.message;
      toast.error(msg ?? 'No se pudo descartar el borrador.');
    }
  };

  const handleNoSalio = async (note?: string) => {
    if (!noSalioCard) return;
    const plate = noSalioCard.plate;
    try {
      await inspectionApi.save({
        vehicleId:          noSalioCard.vehicleId,
        plate,
        returnStatus:       'never_left',
        generalObservation: note,
      });
      setNoSalioCard(null);
      markFlash(plate);
      loadDashboard();
      toast.success(`${plate} — registrado como "no salió".`);
    } catch (err: unknown) {
      const msg = (err as { response?: { data?: { message?: string } } }).response?.data?.message;
      toast.error(msg ?? 'Error al registrar.');
    }
  };

  const handleLogout = async () => {
    await logout();
    navigate('/login');
  };

  // ── Vista del formulario de inspección ──────────────────────────────────────
  if (selectedCard) {
    return (
      <InspectionForm
        card={selectedCard}
        loadFromId={selectedCard.draft?.inspectionId}
        initialPrevKm={selectedCard.lastMileage}
        onSaved={handleSaved}
        onBack={() => setSelectedCard(null)}
      />
    );
  }

  const today = dashboard?.localDate
    ? new Date(dashboard.localDate + 'T12:00:00').toLocaleDateString('es-GT', { day: '2-digit', month: 'short', year: 'numeric' })
    : new Date().toLocaleDateString('es-GT', { day: '2-digit', month: 'short', year: 'numeric' });

  return (
    <div className="flex h-[100dvh] w-full flex-col overflow-hidden bg-background text-foreground">
      {/* ── Header ── */}
      <header className="bg-brand flex flex-shrink-0 items-end justify-between border-b-[3px] border-b-brand-accent px-6 py-4">
        <div>
          <h1 className="text-2xl font-bold leading-none text-white">Registro de garita</h1>
          <p className="mt-1.5 font-mono text-sm text-white/60">
            {today} · {user?.fullName}
          </p>
        </div>
        <Button
          variant="outline" size="sm"
          className="h-10 border-white/30 bg-transparent text-white hover:bg-white/10 hover:text-white"
          onClick={handleLogout}
        >
          <LogOut className="h-4 w-4" />
          Salir
        </Button>
      </header>

      {loading ? (
        <div className="flex flex-1 flex-col items-center justify-center gap-3 text-muted-foreground">
          <Loader2 className="h-9 w-9 animate-spin" />
          <span className="text-base">Cargando flota…</span>
        </div>
      ) : !dashboard ? (
        <div className="flex flex-1 items-center justify-center p-6">
          <div className="w-full max-w-lg rounded-xl border border-border bg-card p-8 text-center shadow-sm">
            <div className="mx-auto mb-4 flex h-16 w-16 items-center justify-center rounded-full bg-muted">
              <Car className="h-8 w-8 text-muted-foreground" />
            </div>
            <h2 className="mb-2 text-2xl font-semibold">No se pudo cargar la flota</h2>
            <p className="mb-7 leading-relaxed text-muted-foreground">
              Verifica tu conexión o que tu usuario tenga una sucursal asignada.
            </p>
            <Button size="touch" className="w-full" onClick={loadDashboard}>Reintentar</Button>
          </div>
        </div>
      ) : (
        <>
          {/* ── Filtros + búsqueda ── */}
          <div className="flex flex-shrink-0 flex-wrap items-center gap-3 border-b border-border bg-card px-6 py-3">
            <Tabs value={filter} onValueChange={v => setFilter(v as FilterKey)}>
              <TabsList className="h-12">
                {(['todos', 'sin_revisar', 'fuera', 'revisado'] as FilterKey[]).map(f => (
                  <TabsTrigger key={f} value={f}>
                    {FILTER_LABELS[f]}
                    {countByFilter(vehicles, f) > 0 && (
                      <span className="ml-1.5 font-mono text-xs tabular-nums opacity-60">
                        {countByFilter(vehicles, f)}
                      </span>
                    )}
                  </TabsTrigger>
                ))}
              </TabsList>
            </Tabs>
            <div className="relative ml-auto w-full max-w-xs">
              <Search className="pointer-events-none absolute left-3 top-1/2 h-5 w-5 -translate-y-1/2 text-muted-foreground" />
              <Input
                className="h-12 pl-10 text-base"
                placeholder="Buscar placa…"
                value={search}
                onChange={e => setSearch(e.target.value)}
                inputMode="search"
              />
            </div>
          </div>

          {/* ── Grid de vehículos ── */}
          <div className="flex-1 overflow-auto p-6">
            {visible.length === 0 ? (
              <div className="pt-12 text-center text-base text-muted-foreground">
                No hay vehículos para este filtro.
              </div>
            ) : (
              <div className="grid grid-cols-1 gap-6 sm:grid-cols-2 xl:grid-cols-3">
                {visible.map(card => (
                  <VehicleCard
                    key={card.vehicleId}
                    card={card}
                    statusTypes={statusTypes}
                    justRevisado={justRevisado === card.plate}
                    onInspeccionar={() => setSelectedCard(card)}
                    onEstadoEspecial={() => setAusenteCard(card)}
                    onNoSalio={() => setNoSalioCard(card)}
                    onEnviarBorrador={() => handleEnviarBorrador(card)}
                    onDescartarBorrador={() => handleDescartarBorrador(card)}
                    onVerReporte={() => handleVerReporte(card)}
                  />
                ))}
              </div>
            )}
          </div>

          {/* ── Footer informativo (sin envío) ── */}
          <footer className="flex flex-shrink-0 items-center gap-6 border-t border-border bg-muted/40 px-6 py-4">
            <div className="flex-1">
              <p className="mb-2 text-sm text-foreground">
                <b className="font-mono tabular-nums">{counts.seen}</b> de{' '}
                <b className="font-mono tabular-nums">{counts.total}</b> registrados hoy
                {counts.unseen > 0 && (
                  <span className="text-muted-foreground">
                    {' '}· <b className="font-mono tabular-nums">{counts.unseen}</b> sin registrar
                  </span>
                )}
              </p>
              <div className="h-2.5 overflow-hidden rounded-full bg-secondary">
                <div
                  className="h-full rounded-full bg-primary transition-all duration-500"
                  style={{ width: counts.total > 0 ? `${(counts.seen / counts.total) * 100}%` : '0%' }}
                />
              </div>
            </div>
            <p className="shrink-0 text-sm text-muted-foreground">
              Los registros se guardan automáticamente.
            </p>
          </footer>
        </>
      )}

      {/* ── Modal de estado especial ── */}
      {ausenteCard && (
        <AusenteModal
          plate={ausenteCard.plate}
          statusTypes={statusTypes}
          onClose={() => setAusenteCard(null)}
          onConfirm={handleAusente}
        />
      )}

      {/* ── Modal "No salió" ── */}
      {noSalioCard && (
        <NoSalioModal
          plate={noSalioCard.plate}
          onClose={() => setNoSalioCard(null)}
          onConfirm={handleNoSalio}
        />
      )}

      {/* ── Modal resumen: envío de borrador ('send') o ver reporte enviado ('view') ── */}
      {summaryModal && (
        <InspectionSummaryModal
          summary={toSummary(summaryModal.card, summaryModal.insp)}
          sending={enviarSending}
          readOnly={summaryModal.mode === 'view'}
          onConfirm={confirmEnviar}
          onClose={() => { if (!enviarSending) setSummaryModal(null); }}
        />
      )}
    </div>
  );
}
