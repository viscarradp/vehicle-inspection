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

interface Driver {
  id: string;
  branchId?: number;
  name: string;
  department: string;
  active: boolean;
}

interface DriverForm {
  name: string;
  department: string;
  branchId: string;
}

const EMPTY_FORM: DriverForm = { name: '', department: '', branchId: '' };

const fieldCls =
  'w-full rounded-lg border border-border bg-background px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary';
const labelCls =
  'mb-1 block text-xs font-semibold uppercase tracking-wider text-muted-foreground';

function DriverFields({
  form,
  onChange,
}: {
  form: DriverForm;
  onChange: (patch: Partial<DriverForm>) => void;
}) {
  return (
    <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
      <div>
        <label className={labelCls}>Nombre</label>
        <input
          className={fieldCls}
          placeholder="Juan Pérez"
          value={form.name}
          onChange={(e) => onChange({ name: e.target.value })}
        />
      </div>
      <div>
        <label className={labelCls}>Departamento</label>
        <input
          className={fieldCls}
          placeholder="Operaciones"
          value={form.department}
          onChange={(e) => onChange({ department: e.target.value })}
        />
      </div>
    </div>
  );
}

export function DriversPage() {
  const { user, canManageFleet, isCountryScope } = useAuth();
  const role = user?.role ?? '';

  const [drivers, setDrivers] = useState<Driver[]>([]);
  const [loading, setLoading] = useState(true);
  const [adding, setAdding] = useState(false);
  const [form, setForm] = useState<DriverForm>(EMPTY_FORM);
  const [saving, setSaving] = useState(false);
  const [toggling, setToggling] = useState<string | null>(null);
  const [editId, setEditId] = useState<string | null>(null);
  const [editForm, setEditForm] = useState<DriverForm>(EMPTY_FORM);
  const [savingEdit, setSavingEdit] = useState(false);
  const [adminBranch, setAdminBranch] = useState<Branch | undefined>();

  const { branchMap } = useBranchLookups(isCountryScope);

  const load = useCallback(() => {
    setLoading(true);
    adminApi.drivers
      .list()
      .then((r) => setDrivers((r.data.data as Driver[]) ?? []))
      .catch(() => toast.error('No se pudieron cargar los conductores.'))
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
    if (!form.name.trim()) {
      toast.error('El nombre es obligatorio.');
      return;
    }
    if ((role === 'admin_pais' || role === 'admin_global') && !form.branchId) {
      toast.error('Selecciona una sucursal.');
      return;
    }
    setSaving(true);
    try {
      const payload: Record<string, unknown> = {
        name: form.name.trim(),
        department: form.department.trim() || undefined,
      };
      if (form.branchId) payload.branchId = parseInt(form.branchId, 10);
      await adminApi.drivers.create(payload);
      toast.success('Conductor agregado.');
      setAdding(false);
      setForm(EMPTY_FORM);
      load();
    } catch (err) {
      toast.error(getApiError(err)?.message ?? 'Error al agregar el conductor.');
    } finally {
      setSaving(false);
    }
  };

  const openEdit = (d: Driver) => {
    setEditId(d.id);
    setEditForm({
      name: d.name,
      department: d.department ?? '',
      branchId: d.branchId ? String(d.branchId) : '',
    });
    setAdding(false);
  };

  const handleSaveEdit = async () => {
    if (!editId || !editForm.name.trim()) {
      toast.error('El nombre es obligatorio.');
      return;
    }
    setSavingEdit(true);
    try {
      await adminApi.drivers.update(editId, {
        name: editForm.name.trim(),
        department: editForm.department.trim(),
      });
      toast.success('Conductor actualizado.');
      setEditId(null);
      load();
    } catch (err) {
      toast.error(getApiError(err)?.message ?? 'Error al actualizar el conductor.');
    } finally {
      setSavingEdit(false);
    }
  };

  const handleToggle = async (d: Driver) => {
    setToggling(d.id);
    try {
      if (d.active) await adminApi.drivers.deactivate(d.id);
      else await adminApi.drivers.activate(d.id);
      toast.success(d.active ? 'Conductor desactivado.' : 'Conductor activado.');
      load();
    } catch (err) {
      toast.error(getApiError(err)?.message ?? 'Error al actualizar el conductor.');
    } finally {
      setToggling(null);
    }
  };

  const activeCount = drivers.filter((d) => d.active).length;
  const inactiveCount = drivers.filter((d) => !d.active).length;

  return (
    <div className="flex flex-1 flex-col overflow-hidden">
      <PageHeader
        title="Conductores"
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
                  <Plus className="h-4 w-4" /> Agregar conductor
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
              <h3 className="mb-4 font-semibold">Nuevo conductor</h3>
              <DriverFields
                form={form}
                onChange={(patch) => setForm((f) => ({ ...f, ...patch }))}
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
                  Guardar conductor
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
              {drivers.map((d) => (
                <div
                  key={d.id}
                  className={cn(
                    'rounded-xl border border-border bg-card px-5 py-4',
                    !d.active && 'opacity-60',
                  )}
                >
                  <div className="flex items-center gap-4">
                    <div className="min-w-0 flex-1">
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="text-base font-bold">{d.name}</span>
                        <span
                          className={cn(
                            'rounded-full px-2.5 py-0.5 text-xs font-semibold',
                            d.active
                              ? 'bg-emerald-100 text-emerald-700'
                              : 'bg-slate-100 text-slate-500',
                          )}
                        >
                          {d.active ? 'Activo' : 'Inactivo'}
                        </span>
                        {isCountryScope && d.branchId != null && (
                          <span className="text-xs text-muted-foreground">
                            · {branchMap.get(d.branchId) ?? `Sucursal ${d.branchId}`}
                          </span>
                        )}
                      </div>
                      {d.department && (
                        <div className="mt-0.5 truncate text-sm text-muted-foreground">
                          {d.department}
                        </div>
                      )}
                    </div>
                    {canManageFleet && (
                      <div className="flex shrink-0 gap-2">
                        <button
                          onClick={() => openEdit(d)}
                          className="flex items-center gap-1 rounded-lg border border-border px-3 py-1.5 text-sm font-medium text-muted-foreground hover:bg-muted"
                        >
                          <Pencil className="h-3.5 w-3.5" />
                          Editar
                        </button>
                        <button
                          disabled={toggling === d.id}
                          onClick={() => handleToggle(d)}
                          className="rounded-lg border border-border px-3 py-1.5 text-sm font-medium text-muted-foreground hover:bg-muted disabled:opacity-50"
                        >
                          {toggling === d.id ? (
                            <Loader2 className="h-4 w-4 animate-spin" />
                          ) : d.active ? (
                            'Desactivar'
                          ) : (
                            'Activar'
                          )}
                        </button>
                      </div>
                    )}
                  </div>

                  {editId === d.id && (
                    <div className="mt-4 border-t border-border pt-4">
                      <h4 className="mb-3 text-sm font-semibold">Editar conductor</h4>
                      <DriverFields
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
              {drivers.length === 0 && (
                <div className="py-12 text-center text-muted-foreground">
                  Sin conductores registrados.
                </div>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
