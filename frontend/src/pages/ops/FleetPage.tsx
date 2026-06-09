import { useEffect, useState, useCallback } from 'react';
import { Loader2, Plus, X, Pencil } from 'lucide-react';
import toast from 'react-hot-toast';

import { adminApi, branchApi } from '@/api/endpoints';
import { useAuth } from '@/context/AuthContext';
import { PageHeader } from '@/components/layouts/OpsShell';
import {
  BranchSelector,
  useBranchLookups,
  type Branch,
} from '@/components/admin/BranchSelector';
import { getApiError } from '@/lib/apiError';
import { cn } from '@/lib/utils';
import {
  normalizeIdentifierInput,
  validateVehicleIdentifiers,
} from '@/lib/vehicleFields';

interface Vehicle {
  id: string;
  branchId?: number;
  plate: string;
  vehicleType: string;
  brand: string;
  model: string;
  year?: number;
  chassisNumber?: string;
  vin?: string;
  engineNumber?: string;
  notes?: string;
  active: boolean;
  initialMileage?: number;
  lastMileage?: number;
  hasOpenIssues?: boolean;
}

interface VehicleForm {
  plate: string;
  vehicleType: string;
  brand: string;
  model: string;
  year: string;
  chassisNumber: string;
  vin: string;
  engineNumber: string;
  notes: string;
  initialMileage: string;
  branchId: string;
}

const EMPTY_FORM: VehicleForm = {
  plate: '',
  vehicleType: 'Pickup',
  brand: 'Toyota',
  model: '',
  year: String(new Date().getFullYear()),
  chassisNumber: '',
  vin: '',
  engineNumber: '',
  notes: '',
  initialMileage: '',
  branchId: '',
};

const fieldCls =
  'w-full rounded-lg border border-border bg-background px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary';
const labelCls =
  'mb-1 block text-xs font-semibold uppercase tracking-wider text-muted-foreground';

function sanitizeIdentifierField(key: 'chassisNumber' | 'vin' | 'engineNumber', value: string): string {
  const upper = value.toUpperCase();
  if (key === 'vin') return upper.replace(/[^A-HJ-NPR-Z0-9]/g, '');
  return upper.replace(/[^A-Z0-9\- ]/g, '');
}

function buildIdentifierPayload(
  form: VehicleForm,
  includeEmpty = false,
): Record<string, string | undefined | null> {
  const chassis = normalizeIdentifierInput(form.chassisNumber);
  const vin = normalizeIdentifierInput(form.vin);
  const engine = normalizeIdentifierInput(form.engineNumber);
  if (includeEmpty) {
    return {
      chassisNumber: chassis ?? null,
      vin: vin ?? null,
      engineNumber: engine ?? null,
    };
  }
  const payload: Record<string, string | undefined> = {};
  if (chassis) payload.chassisNumber = chassis;
  if (vin) payload.vin = vin;
  if (engine) payload.engineNumber = engine;
  return payload;
}

function validateFormIdentifiers(form: VehicleForm): boolean {
  const error = validateVehicleIdentifiers({
    chassisNumber: normalizeIdentifierInput(form.chassisNumber),
    vin: normalizeIdentifierInput(form.vin),
    engineNumber: normalizeIdentifierInput(form.engineNumber),
  });
  if (error) {
    toast.error(error);
    return false;
  }
  return true;
}

function VehicleFields({
  form,
  onChange,
  showInitialMileage,
}: {
  form: VehicleForm;
  onChange: (patch: Partial<VehicleForm>) => void;
  showInitialMileage?: boolean;
}) {
  return (
    <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
      {(
        [
          { label: 'Placa', key: 'plate' as const, placeholder: 'ABC-123' },
          { label: 'Tipo', key: 'vehicleType' as const, placeholder: 'Pickup' },
          { label: 'Marca', key: 'brand' as const, placeholder: 'Toyota' },
          { label: 'Modelo', key: 'model' as const, placeholder: 'Hilux' },
          { label: 'Año', key: 'year' as const, placeholder: '2024' },
        ] as const
      ).map(({ label, key, placeholder }) => (
        <div key={key}>
          <label className={labelCls}>{label}</label>
          <input
            className={fieldCls}
            placeholder={placeholder}
            value={form[key]}
            onChange={(e) => onChange({ [key]: e.target.value })}
          />
        </div>
      ))}
      {(
        [
          { label: 'Nº de chasis', key: 'chassisNumber' as const, placeholder: 'Opcional', maxLength: 50 },
          { label: 'VIN', key: 'vin' as const, placeholder: '17 caracteres', maxLength: 17 },
          { label: 'Nº de motor', key: 'engineNumber' as const, placeholder: 'Opcional', maxLength: 50 },
        ] as const
      ).map(({ label, key, placeholder, maxLength }) => (
        <div key={key}>
          <label className={labelCls}>{label}</label>
          <input
            className={fieldCls}
            placeholder={placeholder}
            maxLength={maxLength}
            value={form[key]}
            onChange={(e) =>
              onChange({ [key]: sanitizeIdentifierField(key, e.target.value) })
            }
          />
        </div>
      ))}
      {showInitialMileage && (
        <div>
          <label className={labelCls}>Km al registro</label>
          <input
            type="number"
            min={0}
            className={fieldCls}
            placeholder="0"
            value={form.initialMileage}
            onChange={(e) => onChange({ initialMileage: e.target.value })}
          />
          <p className="mt-1 text-xs text-muted-foreground">
            Solo al crear el vehículo en el sistema.
          </p>
        </div>
      )}
      <div className="col-span-2 sm:col-span-3">
        <label className={labelCls}>Notas</label>
        <textarea
          className={cn(fieldCls, 'min-h-[72px] resize-y')}
          placeholder="Observaciones internas, historial, etc."
          value={form.notes}
          onChange={(e) => onChange({ notes: e.target.value })}
        />
      </div>
    </div>
  );
}

export function FleetPage() {
  const { user, canManageFleet, isCountryScope } = useAuth();
  const role = user?.role ?? '';

  const [vehicles, setVehicles] = useState<Vehicle[]>([]);
  const [loading, setLoading] = useState(true);
  const [adding, setAdding] = useState(false);
  const [form, setForm] = useState<VehicleForm>(EMPTY_FORM);
  const [saving, setSaving] = useState(false);
  const [toggling, setToggling] = useState<string | null>(null);
  const [editId, setEditId] = useState<string | null>(null);
  const [editForm, setEditForm] = useState<VehicleForm>(EMPTY_FORM);
  const [savingEdit, setSavingEdit] = useState(false);
  const [adminBranch, setAdminBranch] = useState<Branch | undefined>();

  const { branchMap } = useBranchLookups(isCountryScope);

  const load = useCallback(() => {
    setLoading(true);
    adminApi.vehicles
      .list()
      .then((r) => setVehicles((r.data.data as Vehicle[]) ?? []))
      .catch(() => toast.error('No se pudo cargar la flota.'))
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  useEffect(() => {
    if (role !== 'admin') return;
    branchApi
      .list()
      .then((r) => {
        const list = (r.data.data as Branch[]) ?? [];
        if (list.length > 0) setAdminBranch(list[0]);
      })
      .catch(() => {});
  }, [role]);

  const handleAdd = async () => {
    if (!form.plate.trim() || !form.model.trim()) {
      toast.error('Placa y modelo son obligatorios.');
      return;
    }
    if ((role === 'admin_pais' || role === 'admin_global') && !form.branchId) {
      toast.error('Selecciona una sucursal.');
      return;
    }
    if (!validateFormIdentifiers(form)) return;
    setSaving(true);
    try {
      const payload: Record<string, unknown> = {
        plate: form.plate.toUpperCase().trim(),
        vehicleType: form.vehicleType,
        brand: form.brand,
        model: form.model,
        year: parseInt(form.year, 10) || undefined,
        notes: form.notes.trim() || undefined,
        initialMileage: parseInt(form.initialMileage, 10) || 0,
        ...buildIdentifierPayload(form),
      };
      if (form.branchId) payload.branchId = parseInt(form.branchId, 10);
      await adminApi.vehicles.create(payload);
      toast.success('Vehículo agregado.');
      setAdding(false);
      setForm(EMPTY_FORM);
      load();
    } catch (err) {
      toast.error(getApiError(err)?.message ?? 'Error al agregar el vehículo.');
    } finally {
      setSaving(false);
    }
  };

  const openEdit = (v: Vehicle) => {
    setEditId(v.id);
    setEditForm({
      plate: v.plate,
      vehicleType: v.vehicleType,
      brand: v.brand,
      model: v.model,
      year: v.year ? String(v.year) : '',
      chassisNumber: v.chassisNumber ?? '',
      vin: v.vin ?? '',
      engineNumber: v.engineNumber ?? '',
      notes: v.notes ?? '',
      initialMileage: '',
      branchId: v.branchId ? String(v.branchId) : '',
    });
    setAdding(false);
  };

  const handleSaveEdit = async () => {
    if (!editId || !editForm.plate.trim() || !editForm.model.trim()) {
      toast.error('Placa y modelo son obligatorios.');
      return;
    }
    if (!validateFormIdentifiers(editForm)) return;
    setSavingEdit(true);
    try {
      await adminApi.vehicles.update(editId, {
        plate: editForm.plate.toUpperCase().trim(),
        vehicleType: editForm.vehicleType,
        brand: editForm.brand,
        model: editForm.model,
        year: parseInt(editForm.year, 10) || undefined,
        notes: editForm.notes.trim() || undefined,
        ...buildIdentifierPayload(editForm, true),
      });
      toast.success('Vehículo actualizado.');
      setEditId(null);
      load();
    } catch (err) {
      toast.error(getApiError(err)?.message ?? 'Error al actualizar el vehículo.');
    } finally {
      setSavingEdit(false);
    }
  };

  const handleToggle = async (v: Vehicle) => {
    setToggling(v.id);
    try {
      if (v.active) await adminApi.vehicles.deactivate(v.id);
      else await adminApi.vehicles.activate(v.id);
      toast.success(v.active ? 'Vehículo desactivado.' : 'Vehículo activado.');
      load();
    } catch (err) {
      toast.error(getApiError(err)?.message ?? 'Error al actualizar el vehículo.');
    } finally {
      setToggling(null);
    }
  };

  const activeCount = vehicles.filter((v) => v.active).length;
  const inactiveCount = vehicles.filter((v) => !v.active).length;

  return (
    <div className="flex flex-1 flex-col overflow-hidden">
      <PageHeader
        title="Flota"
        subtitle={`${activeCount} activos · ${inactiveCount} inactivos`}
        action={
          canManageFleet ? (
            <button
              onClick={() => {
                setAdding((a) => !a);
                setEditId(null);
              }}
              className={cn(
                'flex items-center gap-1.5 rounded-lg border px-3 py-2 text-sm font-medium transition-colors',
                adding
                  ? 'border-border text-muted-foreground hover:bg-muted'
                  : 'bg-brand text-primary-foreground hover:bg-brand-hover',
              )}
            >
              {adding ? (
                <>
                  <X className="h-4 w-4" /> Cancelar
                </>
              ) : (
                <>
                  <Plus className="h-4 w-4" /> Agregar vehículo
                </>
              )}
            </button>
          ) : undefined
        }
      />

      <div className="flex-1 overflow-auto px-6 py-5">
        <div className="mx-auto max-w-3xl space-y-4">
          {adding && (
            <div className="rounded-xl border border-border bg-card p-5">
              <h3 className="mb-4 font-semibold">Nuevo vehículo</h3>
              <VehicleFields
                form={form}
                onChange={(patch) => setForm((f) => ({ ...f, ...patch }))}
                showInitialMileage
              />
              <div className="mt-3 grid grid-cols-1 gap-3 sm:grid-cols-2">
                <BranchSelector
                  actorRole={role}
                  branchId={form.branchId}
                  onBranchChange={(id) => setForm((f) => ({ ...f, branchId: id }))}
                  adminBranch={adminBranch}
                />
              </div>
              <div className="mt-4 flex justify-end">
                <button
                  disabled={saving}
                  onClick={handleAdd}
                  className="flex items-center gap-1.5 rounded-lg bg-brand px-4 py-2 text-sm font-semibold text-primary-foreground hover:bg-brand-hover disabled:opacity-50"
                >
                  {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
                  Guardar vehículo
                </button>
              </div>
            </div>
          )}

          {loading ? (
            <div className="flex justify-center py-16">
              <Loader2 className="h-7 w-7 animate-spin text-muted-foreground" />
            </div>
          ) : (
            <div className="flex flex-col gap-2">
              {vehicles.map((v) => (
                <div
                  key={v.id}
                  className={cn(
                    'rounded-xl border bg-card px-5 py-4',
                    !v.active && 'opacity-60',
                    v.hasOpenIssues ? 'border-red-200' : 'border-border',
                  )}
                >
                  <div className="flex items-center gap-4">
                    <div className="min-w-0 flex-1">
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="font-mono text-lg font-bold">{v.plate}</span>
                        {v.hasOpenIssues && (
                          <span className="rounded-full border border-red-200 bg-red-100 px-2 py-0.5 text-xs font-semibold text-red-700">
                            Daño abierto
                          </span>
                        )}
                        <span
                          className={cn(
                            'rounded-full px-2.5 py-0.5 text-xs font-semibold',
                            v.active
                              ? 'bg-emerald-100 text-emerald-700'
                              : 'bg-slate-100 text-slate-500',
                          )}
                        >
                          {v.active ? 'Activo' : 'Inactivo'}
                        </span>
                        {isCountryScope && v.branchId != null && (
                          <span className="text-xs text-muted-foreground">
                            · {branchMap.get(v.branchId) ?? `Sucursal ${v.branchId}`}
                          </span>
                        )}
                      </div>
                      <div className="mt-0.5 truncate text-sm text-muted-foreground">
                        {v.vehicleType} · {v.brand} {v.model} {v.year ?? ''}
                        {(v.initialMileage ?? 0) > 0 && (
                          <span className="ml-2">
                            · Km inicial: {v.initialMileage!.toLocaleString('es-GT')}
                          </span>
                        )}
                        {v.lastMileage != null &&
                          v.lastMileage !== v.initialMileage && (
                            <span className="ml-2">
                              · Actual: {v.lastMileage.toLocaleString('es-GT')}
                            </span>
                          )}
                      </div>
                      {(v.chassisNumber || v.vin || v.engineNumber) && (
                        <div className="mt-1 flex flex-wrap gap-x-3 gap-y-0.5 text-xs text-muted-foreground">
                          {v.vin && <span>VIN: {v.vin}</span>}
                          {v.chassisNumber && <span>Chasis: {v.chassisNumber}</span>}
                          {v.engineNumber && <span>Motor: {v.engineNumber}</span>}
                        </div>
                      )}
                      {v.notes && (
                        <p className="mt-1 line-clamp-2 text-xs text-muted-foreground">
                          {v.notes}
                        </p>
                      )}
                    </div>
                    {canManageFleet && (
                      <div className="flex shrink-0 gap-2">
                        <button
                          onClick={() => openEdit(v)}
                          className="flex items-center gap-1 rounded-lg border border-border px-3 py-1.5 text-sm font-medium text-muted-foreground hover:bg-muted"
                        >
                          <Pencil className="h-3.5 w-3.5" />
                          Editar
                        </button>
                        <button
                          disabled={toggling === v.id}
                          onClick={() => handleToggle(v)}
                          className="rounded-lg border border-border px-3 py-1.5 text-sm font-medium text-muted-foreground hover:bg-muted disabled:opacity-50"
                        >
                          {toggling === v.id ? (
                            <Loader2 className="h-4 w-4 animate-spin" />
                          ) : v.active ? (
                            'Desactivar'
                          ) : (
                            'Activar'
                          )}
                        </button>
                      </div>
                    )}
                  </div>

                  {editId === v.id && (
                    <div className="mt-4 border-t border-border pt-4">
                      <h4 className="mb-3 text-sm font-semibold">Editar vehículo</h4>
                      <VehicleFields
                        form={editForm}
                        onChange={(patch) =>
                          setEditForm((f) => ({ ...f, ...patch }))
                        }
                      />
                      <div className="mt-4 flex justify-end gap-2">
                        <button
                          onClick={() => setEditId(null)}
                          className="rounded-lg border border-border px-3 py-2 text-sm hover:bg-muted"
                        >
                          Cancelar
                        </button>
                        <button
                          disabled={savingEdit}
                          onClick={handleSaveEdit}
                          className="flex items-center gap-1.5 rounded-lg bg-brand px-4 py-2 text-sm font-semibold text-primary-foreground hover:bg-brand-hover disabled:opacity-50"
                        >
                          {savingEdit ? (
                            <Loader2 className="h-4 w-4 animate-spin" />
                          ) : null}
                          Guardar cambios
                        </button>
                      </div>
                    </div>
                  )}
                </div>
              ))}
              {vehicles.length === 0 && (
                <div className="py-12 text-center text-muted-foreground">
                  Sin vehículos registrados.
                </div>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
