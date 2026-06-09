import { useEffect, useState } from 'react';
import { Plus, Pencil, Trash2, Power, PowerOff, ShieldAlert } from 'lucide-react';
import toast from 'react-hot-toast';

import { PageHeader } from '@/components/layouts/OpsShell';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import { COLOR_PALETTE, VALID_COLORS } from '@/components/StatusBadge';
import { vehicleStatusTypeApi } from '@/api/endpoints';
import { invalidateVehicleStatusTypesCache } from '@/hooks/useVehicleStatusTypes';
import type { VehicleStatusType } from '@/types';

// ─── Formulario inline ────────────────────────────────────────────────────────

interface FormState {
  labelEs:   string;
  color:     string;
  sortOrder: string;
}

const EMPTY_FORM: FormState = { labelEs: '', color: 'blue', sortOrder: '0' };

function ColorPicker({ value, onChange }: { value: string; onChange: (c: string) => void }) {
  return (
    <div className="flex flex-wrap gap-2">
      {VALID_COLORS.map(c => {
        const p = COLOR_PALETTE[c];
        return (
          <button
            key={c}
            type="button"
            title={c}
            onClick={() => onChange(c)}
            className={cn(
              'h-7 w-7 rounded-full border-2 transition-transform',
              p.dot,
              value === c ? 'scale-125 border-foreground' : 'border-transparent hover:scale-110',
            )}
          />
        );
      })}
    </div>
  );
}

interface TypeRowProps {
  type: VehicleStatusType;
  onEdit: (t: VehicleStatusType) => void;
  onToggle: (t: VehicleStatusType) => void;
  onDelete: (t: VehicleStatusType) => void;
}

function TypeRow({ type, onEdit, onToggle, onDelete }: TypeRowProps) {
  const palette = COLOR_PALETTE[type.color] ?? COLOR_PALETTE.slate;
  return (
    <div className={cn(
      'flex items-center gap-4 rounded-lg border px-4 py-3 transition-opacity',
      !type.active && 'opacity-50',
    )}>
      <span className={cn('h-4 w-4 shrink-0 rounded-full', palette.dot)} />
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2">
          <span className="font-semibold text-foreground">{type.labelEs}</span>
          {type.isSystem && (
            <span className="flex items-center gap-1 rounded bg-muted px-1.5 py-0.5 text-xs text-muted-foreground">
              <ShieldAlert className="h-3 w-3" /> sistema
            </span>
          )}
          {!type.active && (
            <span className="rounded bg-muted px-1.5 py-0.5 text-xs text-muted-foreground">inactivo</span>
          )}
        </div>
        <span className="font-mono text-xs text-muted-foreground">{type.key}</span>
      </div>
      <div className="flex shrink-0 gap-1">
        {!type.isSystem && (
          <Button size="sm" variant="ghost" onClick={() => onEdit(type)} title="Editar">
            <Pencil className="h-4 w-4" />
          </Button>
        )}
        <Button size="sm" variant="ghost" onClick={() => onToggle(type)} title={type.active ? 'Desactivar' : 'Activar'}>
          {type.active ? <PowerOff className="h-4 w-4" /> : <Power className="h-4 w-4 text-emerald-600" />}
        </Button>
        {!type.isSystem && (
          <Button size="sm" variant="ghost" className="text-red-600 hover:text-red-700" onClick={() => onDelete(type)} title="Eliminar">
            <Trash2 className="h-4 w-4" />
          </Button>
        )}
      </div>
    </div>
  );
}

// ─── Página ───────────────────────────────────────────────────────────────────

export function VehicleStatusTypesPage() {
  const [types, setTypes]         = useState<VehicleStatusType[]>([]);
  const [loading, setLoading]     = useState(true);
  const [showForm, setShowForm]   = useState(false);
  const [editing, setEditing]     = useState<VehicleStatusType | null>(null);
  const [form, setForm]           = useState<FormState>(EMPTY_FORM);
  const [saving, setSaving]       = useState(false);
  const [deleteTarget, setDelete] = useState<VehicleStatusType | null>(null);

  const load = async () => {
    setLoading(true);
    try {
      const res = await vehicleStatusTypeApi.listAll();
      setTypes(res.data.data as VehicleStatusType[]);
    } catch {
      toast.error('Error al cargar los tipos.');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { load(); }, []);

  const openCreate = () => { setEditing(null); setForm(EMPTY_FORM); setShowForm(true); };

  const openEdit = (t: VehicleStatusType) => {
    setEditing(t);
    setForm({ labelEs: t.labelEs, color: t.color, sortOrder: String(t.sortOrder) });
    setShowForm(true);
  };

  const closeForm = () => { setShowForm(false); setEditing(null); };

  const handleSave = async () => {
    if (!form.labelEs.trim()) { toast.error('El nombre es obligatorio.'); return; }
    setSaving(true);
    try {
      const payload = {
        labelEs:   form.labelEs.trim(),
        color:     form.color,
        sortOrder: parseInt(form.sortOrder, 10) || 0,
      };
      if (editing) {
        await vehicleStatusTypeApi.update(editing.id, payload);
        toast.success('Tipo actualizado.');
      } else {
        await vehicleStatusTypeApi.create(payload);
        toast.success('Tipo creado.');
      }
      invalidateVehicleStatusTypesCache();
      closeForm();
      load();
    } catch (err: unknown) {
      const msg = (err as { response?: { data?: { message?: string } } }).response?.data?.message;
      toast.error(msg ?? 'Error al guardar.');
    } finally {
      setSaving(false);
    }
  };

  const handleToggle = async (t: VehicleStatusType) => {
    try {
      await vehicleStatusTypeApi.toggle(t.id);
      toast.success(`"${t.labelEs}" ${t.active ? 'desactivado' : 'activado'}.`);
      invalidateVehicleStatusTypesCache();
      load();
    } catch {
      toast.error('Error al cambiar estado.');
    }
  };

  const handleDelete = async () => {
    if (!deleteTarget) return;
    try {
      await vehicleStatusTypeApi.delete(deleteTarget.id);
      toast.success(`"${deleteTarget.labelEs}" eliminado.`);
      invalidateVehicleStatusTypesCache();
      setDelete(null);
      load();
    } catch (err: unknown) {
      const msg = (err as { response?: { data?: { message?: string } } }).response?.data?.message;
      toast.error(msg ?? 'Error al eliminar.');
      setDelete(null);
    }
  };

  const systemTypes  = types.filter(t => t.isSystem);
  const customTypes  = types.filter(t => !t.isSystem);

  return (
    <div className="flex flex-1 flex-col overflow-hidden">
      <PageHeader
        title="Estados especiales de vehículos"
        subtitle="Configura los estados persistentes que el guardia puede asignar a un vehículo"
        action={
          <Button onClick={openCreate}>
            <Plus className="h-4 w-4" /> Nuevo estado
          </Button>
        }
      />

      <div className="flex-1 overflow-auto p-6">
        {loading ? (
          <p className="text-sm text-muted-foreground">Cargando…</p>
        ) : (
          <div className="mx-auto max-w-2xl space-y-8">

            {/* ── Formulario ── */}
            {showForm && (
              <div className="rounded-xl border border-border bg-card p-6 shadow-sm">
                <h3 className="mb-4 text-base font-semibold">
                  {editing ? 'Editar estado' : 'Nuevo estado'}
                </h3>
                <div className="space-y-4">
                  <div>
                    <label className="mb-1 block text-sm font-medium text-muted-foreground">Nombre del estado</label>
                    <input
                      className="input-box w-full"
                      placeholder="Ej: Préstamo externo, Reparación larga…"
                      value={form.labelEs}
                      onChange={e => setForm(f => ({ ...f, labelEs: e.target.value }))}
                      autoFocus
                    />
                  </div>
                  <div>
                    <label className="mb-2 block text-sm font-medium text-muted-foreground">Color</label>
                    <ColorPicker value={form.color} onChange={c => setForm(f => ({ ...f, color: c }))} />
                    <div className={cn('mt-2 inline-flex items-center gap-1.5 rounded-full border px-3 py-1 text-sm font-medium', COLOR_PALETTE[form.color]?.badge ?? '')}>
                      <span className={cn('h-2 w-2 rounded-full', COLOR_PALETTE[form.color]?.dot ?? '')} />
                      {form.labelEs || 'Vista previa'}
                    </div>
                  </div>
                  <div>
                    <label className="mb-1 block text-sm font-medium text-muted-foreground">Orden de visualización</label>
                    <input
                      type="number"
                      className="input-box w-24"
                      min={0}
                      value={form.sortOrder}
                      onChange={e => setForm(f => ({ ...f, sortOrder: e.target.value }))}
                    />
                  </div>
                  <div className="flex gap-3 pt-2">
                    <Button variant="outline" onClick={closeForm} disabled={saving}>Cancelar</Button>
                    <Button onClick={handleSave} disabled={saving}>
                      {saving ? 'Guardando…' : (editing ? 'Guardar cambios' : 'Crear estado')}
                    </Button>
                  </div>
                </div>
              </div>
            )}

            {/* ── Tipos de sistema ── */}
            {systemTypes.length > 0 && (
              <div>
                <h4 className="mb-3 text-sm font-semibold uppercase tracking-wide text-muted-foreground">
                  Estados de sistema <span className="font-normal normal-case">(no eliminables)</span>
                </h4>
                <div className="space-y-2">
                  {systemTypes.map(t => (
                    <TypeRow key={t.id} type={t} onEdit={openEdit} onToggle={handleToggle} onDelete={setDelete} />
                  ))}
                </div>
              </div>
            )}

            {/* ── Tipos personalizados ── */}
            <div>
              <h4 className="mb-3 text-sm font-semibold uppercase tracking-wide text-muted-foreground">
                Estados personalizados
              </h4>
              {customTypes.length === 0 ? (
                <p className="text-sm text-muted-foreground">
                  Aún no hay estados personalizados. Crea uno con el botón "Nuevo estado".
                </p>
              ) : (
                <div className="space-y-2">
                  {customTypes.map(t => (
                    <TypeRow key={t.id} type={t} onEdit={openEdit} onToggle={handleToggle} onDelete={setDelete} />
                  ))}
                </div>
              )}
            </div>
          </div>
        )}
      </div>

      {/* ── Confirm delete ── */}
      {deleteTarget && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
          <div className="w-full max-w-sm rounded-xl border border-border bg-card p-6 shadow-xl">
            <h3 className="text-lg font-semibold">Eliminar estado</h3>
            <p className="mt-2 text-sm text-muted-foreground">
              ¿Eliminar <span className="font-semibold text-foreground">"{deleteTarget.labelEs}"</span>?
              Los vehículos que tengan este estado actualmente quedarán sin estado reconocido
              hasta que se les asigne uno nuevo.
            </p>
            <div className="mt-5 flex gap-3">
              <Button variant="outline" className="flex-1" onClick={() => setDelete(null)}>Cancelar</Button>
              <Button variant="destructive" className="flex-1" onClick={handleDelete}>Eliminar</Button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
