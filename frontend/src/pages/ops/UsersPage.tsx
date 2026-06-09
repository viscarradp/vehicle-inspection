import { useEffect, useState, useCallback } from 'react';
import { Loader2, Plus, X, KeyRound, Pencil, UserX, UserCheck } from 'lucide-react';
import toast from 'react-hot-toast';

import { adminApi, branchApi } from '@/api/endpoints';
import { useAuth } from '@/context/AuthContext';
import { PageHeader } from '@/components/layouts/OpsShell';
import {
  BranchSelector,
  CountrySelector,
  useBranchLookups,
  type Branch,
} from '@/components/admin/BranchSelector';
import { getApiError } from '@/lib/apiError';
import {
  assignableRoles,
  canManageUser,
  isOperationalRole,
} from '@/lib/roleCapabilities';
import type { UserRole } from '@/types';
import { cn } from '@/lib/utils';

interface AdminUser {
  id: string | number;
  username: string;
  fullName: string;
  role: UserRole;
  active: boolean;
  branchId?: number | null;
  countryId?: number | null;
}

interface CreateForm {
  username: string;
  fullName: string;
  role: UserRole;
  password: string;
  branchId: string;
  countryId: string;
}

interface EditForm {
  fullName: string;
  role: UserRole;
  branchId: string;
  countryId: string;
  active: boolean;
  password: string;
}

const EMPTY_CREATE: CreateForm = {
  username: '',
  fullName: '',
  role: 'guardia',
  password: '',
  branchId: '',
  countryId: '',
};

const ROLE_LABELS: Record<string, string> = {
  guardia: 'Guardia',
  jefe_operaciones: 'Jefe de Operaciones',
  admin: 'Administrador',
  admin_pais: 'Admin País',
  admin_global: 'Admin Global',
};

const ROLE_BADGE: Record<string, string> = {
  guardia: 'bg-slate-100 text-slate-700',
  jefe_operaciones: 'bg-blue-100 text-blue-700',
  admin: 'bg-violet-100 text-violet-700',
  admin_pais: 'bg-indigo-100 text-indigo-700',
  admin_global: 'bg-orange-100 text-orange-700',
};

const fieldCls =
  'w-full rounded-lg border border-border bg-background px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary';
const labelCls =
  'mb-1 block text-xs font-semibold uppercase tracking-wider text-muted-foreground';

function userId(u: AdminUser): string {
  return String(u.id);
}

function scopeLabel(
  u: AdminUser,
  branchMap: Map<number, string>,
  countryMap: Map<number, string>,
): string | null {
  if (isOperationalRole(u.role) && u.branchId != null) {
    return branchMap.get(u.branchId) ?? `Sucursal ${u.branchId}`;
  }
  if (u.role === 'admin_pais' && u.countryId != null) {
    return countryMap.get(u.countryId) ?? `País ${u.countryId}`;
  }
  if (u.role === 'admin_global') return 'Ámbito global';
  return null;
}

export function UsersPage() {
  const { user: actor, isCountryScope, isGlobalAdmin } = useAuth();
  const actorRole = (actor?.role ?? 'guardia') as UserRole;
  const assignable = assignableRoles(actorRole);

  const [users, setUsers] = useState<AdminUser[]>([]);
  const [loading, setLoading] = useState(true);
  const [adding, setAdding] = useState(false);
  const [form, setForm] = useState<CreateForm>(EMPTY_CREATE);
  const [saving, setSaving] = useState(false);
  const [pinTarget, setPinTarget] = useState<string | null>(null);
  const [newPin, setNewPin] = useState('');
  const [savingPin, setSavingPin] = useState(false);
  const [editTarget, setEditTarget] = useState<string | null>(null);
  const [editForm, setEditForm] = useState<EditForm | null>(null);
  const [savingEdit, setSavingEdit] = useState(false);
  const [toggling, setToggling] = useState<string | null>(null);
  const [adminBranch, setAdminBranch] = useState<Branch | undefined>();

  const { branchMap, countryMap } = useBranchLookups(isCountryScope);

  const load = useCallback(() => {
    setLoading(true);
    adminApi.users
      .list()
      .then((r) => {
        const raw = (r.data.data as AdminUser[]) ?? [];
        setUsers(
          raw.map((u) => ({
            ...u,
            id: String(u.id),
            username: (u.username ?? '').toLowerCase(),
          })),
        );
      })
      .catch(() => toast.error('No se pudo cargar los usuarios.'))
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  useEffect(() => {
    if (actorRole !== 'admin') return;
    branchApi
      .list()
      .then((r) => {
        const list = (r.data.data as Branch[]) ?? [];
        if (list.length > 0) setAdminBranch(list[0]);
      })
      .catch(() => {});
  }, [actorRole]);

  const buildCreatePayload = (): Record<string, unknown> | null => {
    const { username, fullName, role, password, branchId, countryId } = form;
    if (!username.trim() || !fullName.trim() || !password) {
      toast.error('Usuario, nombre y PIN son obligatorios.');
      return null;
    }
    if (!/^\d{4}$/.test(password)) {
      toast.error('El PIN debe ser exactamente 4 dígitos numéricos.');
      return null;
    }
    const payload: Record<string, unknown> = {
      username: username.trim().toLowerCase(),
      fullName: fullName.trim(),
      role,
      password,
    };
    if (isOperationalRole(role)) {
      if (actorRole === 'admin') {
        if (!actor?.branchId) {
          toast.error('Tu cuenta no tiene sucursal asignada.');
          return null;
        }
        payload.branchId = actor.branchId;
      } else if (!branchId) {
        toast.error('Selecciona una sucursal.');
        return null;
      } else {
        payload.branchId = parseInt(branchId, 10);
      }
    }
    if (role === 'admin_pais') {
      if (!isGlobalAdmin) {
        toast.error('Solo admin global puede crear admin país.');
        return null;
      }
      if (!countryId) {
        toast.error('Selecciona un país.');
        return null;
      }
      payload.countryId = parseInt(countryId, 10);
    }
    return payload;
  };

  const handleAdd = async () => {
    const payload = buildCreatePayload();
    if (!payload) return;
    setSaving(true);
    try {
      await adminApi.users.create(payload);
      toast.success('Usuario creado.');
      setAdding(false);
      setForm(EMPTY_CREATE);
      load();
    } catch (err) {
      toast.error(getApiError(err)?.message ?? 'Error al crear el usuario.');
    } finally {
      setSaving(false);
    }
  };

  const openEdit = (u: AdminUser) => {
    setEditTarget(userId(u));
    setEditForm({
      fullName: u.fullName,
      role: u.role,
      branchId: u.branchId != null ? String(u.branchId) : '',
      countryId: u.countryId != null ? String(u.countryId) : '',
      active: u.active,
      password: '',
    });
    setPinTarget(null);
    setAdding(false);
  };

  const handleSaveEdit = async (id: string) => {
    if (!editForm) return;
    if (!editForm.fullName.trim()) {
      toast.error('El nombre es obligatorio.');
      return;
    }
    if (editForm.password && !/^\d{4}$/.test(editForm.password)) {
      toast.error('El PIN debe ser exactamente 4 dígitos.');
      return;
    }
    const payload: Record<string, unknown> = {
      fullName: editForm.fullName.trim(),
      role: editForm.role,
      active: editForm.active,
    };
    if (isOperationalRole(editForm.role)) {
      if (actorRole === 'admin' && actor?.branchId) {
        payload.branchId = actor.branchId;
      } else if (isCountryScope && editForm.branchId) {
        payload.branchId = parseInt(editForm.branchId, 10);
      }
    }
    if (editForm.role === 'admin_pais' && isGlobalAdmin && editForm.countryId) {
      payload.countryId = parseInt(editForm.countryId, 10);
    }
    if (editForm.password) payload.password = editForm.password;

    setSavingEdit(true);
    try {
      await adminApi.users.update(id, payload);
      toast.success('Usuario actualizado.');
      setEditTarget(null);
      setEditForm(null);
      load();
    } catch (err) {
      toast.error(getApiError(err)?.message ?? 'Error al actualizar el usuario.');
    } finally {
      setSavingEdit(false);
    }
  };

  const handleToggleActive = async (u: AdminUser) => {
    const id = userId(u);
    setToggling(id);
    try {
      await adminApi.users.update(id, { active: !u.active });
      toast.success(u.active ? 'Usuario desactivado.' : 'Usuario activado.');
      load();
    } catch (err) {
      toast.error(getApiError(err)?.message ?? 'Error al actualizar el usuario.');
    } finally {
      setToggling(null);
    }
  };

  const handleChangePin = async (id: string) => {
    if (!/^\d{4}$/.test(newPin)) {
      toast.error('El PIN debe ser exactamente 4 dígitos numéricos.');
      return;
    }
    setSavingPin(true);
    try {
      await adminApi.users.update(id, { password: newPin });
      toast.success('PIN actualizado.');
      setPinTarget(null);
      setNewPin('');
    } catch (err) {
      toast.error(getApiError(err)?.message ?? 'Error al actualizar el PIN.');
    } finally {
      setSavingPin(false);
    }
  };

  const showBranchOnCreate = isOperationalRole(form.role) && actorRole !== 'admin';
  const showCountryOnCreate = form.role === 'admin_pais' && isGlobalAdmin;

  return (
    <div className="flex flex-1 flex-col overflow-hidden">
      <PageHeader
        title="Usuarios"
        subtitle={`${users.length} usuario${users.length !== 1 ? 's' : ''} registrado${users.length !== 1 ? 's' : ''}`}
        action={
          assignable.length > 0 ? (
            <button
              onClick={() => {
                setAdding((a) => !a);
                setEditTarget(null);
              }}
              className={cn(
                'flex items-center gap-1.5 rounded-lg border px-3 py-2 text-sm font-medium transition-colors',
                adding
                  ? 'border-border text-muted-foreground hover:bg-muted'
                  : 'border-primary bg-primary text-primary-foreground hover:bg-primary/90',
              )}
            >
              {adding ? (
                <>
                  <X className="h-4 w-4" /> Cancelar
                </>
              ) : (
                <>
                  <Plus className="h-4 w-4" /> Nuevo usuario
                </>
              )}
            </button>
          ) : undefined
        }
      />

      <div className="flex-1 overflow-auto px-6 py-5">
        <div className="mx-auto max-w-2xl space-y-4">
          {adding && (
            <div className="rounded-xl border border-border bg-card p-5">
              <h3 className="mb-4 font-semibold">Nuevo usuario</h3>
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                <div>
                  <label className={labelCls}>Usuario (sin espacios)</label>
                  <input
                    className={fieldCls}
                    placeholder="nombre.apellido"
                    value={form.username}
                    autoCapitalize="none"
                    onChange={(e) =>
                      setForm({ ...form, username: e.target.value })
                    }
                  />
                </div>
                <div>
                  <label className={labelCls}>Nombre completo</label>
                  <input
                    className={fieldCls}
                    placeholder="Juan Pérez"
                    value={form.fullName}
                    onChange={(e) =>
                      setForm({ ...form, fullName: e.target.value })
                    }
                  />
                </div>
                <div>
                  <label className={labelCls}>Rol</label>
                  <select
                    className={fieldCls}
                    value={form.role}
                    onChange={(e) =>
                      setForm({
                        ...form,
                        role: e.target.value as UserRole,
                        branchId: '',
                        countryId: '',
                      })
                    }
                  >
                    {assignable.map((r) => (
                      <option key={r} value={r}>
                        {ROLE_LABELS[r] ?? r}
                      </option>
                    ))}
                  </select>
                </div>
                <div>
                  <label className={labelCls}>PIN inicial (4 dígitos)</label>
                  <input
                    className={cn(fieldCls, 'font-mono tracking-widest')}
                    placeholder="••••"
                    maxLength={4}
                    inputMode="numeric"
                    type="password"
                    value={form.password}
                    onChange={(e) =>
                      setForm({ ...form, password: e.target.value })
                    }
                  />
                </div>
              </div>

              {(showBranchOnCreate || actorRole === 'admin') &&
                isOperationalRole(form.role) && (
                  <div className="mt-3 grid grid-cols-1 gap-3 sm:grid-cols-2">
                    <BranchSelector
                      actorRole={actorRole}
                      branchId={form.branchId}
                      onBranchChange={(id) =>
                        setForm({ ...form, branchId: id })
                      }
                      adminBranch={adminBranch}
                    />
                  </div>
                )}

              {showCountryOnCreate && (
                <div className="mt-3 grid grid-cols-1 gap-3 sm:grid-cols-2">
                  <CountrySelector
                    countryId={form.countryId}
                    onCountryChange={(id) =>
                      setForm({ ...form, countryId: id })
                    }
                  />
                </div>
              )}

              <div className="mt-4 flex justify-end">
                <button
                  disabled={saving}
                  onClick={handleAdd}
                  className="flex items-center gap-1.5 rounded-lg bg-primary px-4 py-2 text-sm font-semibold text-primary-foreground hover:bg-primary/90 disabled:opacity-50"
                >
                  {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
                  Crear usuario
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
              {users.map((u) => {
                const id = userId(u);
                const canManage =
                  actor &&
                  actor.userId !== id &&
                  canManageUser(actorRole, u.role);
                const scope = scopeLabel(u, branchMap, countryMap);

                return (
                  <div
                    key={id}
                    className={cn(
                      'rounded-xl border border-border bg-card p-4',
                      !u.active && 'opacity-60',
                    )}
                  >
                    <div className="flex items-center gap-3">
                      <div className="min-w-0 flex-1">
                        <div className="flex flex-wrap items-center gap-2">
                          <span className="font-semibold">{u.fullName}</span>
                          <span
                            className={cn(
                              'rounded-full px-2.5 py-0.5 text-xs font-semibold',
                              ROLE_BADGE[u.role] ??
                                'bg-muted text-muted-foreground',
                            )}
                          >
                            {ROLE_LABELS[u.role] ?? u.role}
                          </span>
                          {!u.active && (
                            <span className="rounded-full bg-slate-200 px-2 py-0.5 text-xs font-semibold text-slate-600">
                              Inactivo
                            </span>
                          )}
                        </div>
                        <div className="mt-0.5 font-mono text-sm text-muted-foreground">
                          {u.username}
                        </div>
                        {scope && (
                          <div className="mt-0.5 text-xs text-muted-foreground">
                            {scope}
                          </div>
                        )}
                      </div>
                      {canManage && (
                        <div className="flex shrink-0 flex-wrap gap-2">
                          <button
                            onClick={() => openEdit(u)}
                            className="flex items-center gap-1 rounded-lg border border-border px-3 py-1.5 text-sm font-medium text-muted-foreground hover:bg-muted"
                          >
                            <Pencil className="h-3.5 w-3.5" />
                            Editar
                          </button>
                          <button
                            onClick={() => {
                              setPinTarget(id);
                              setNewPin('');
                              setEditTarget(null);
                            }}
                            className="flex items-center gap-1 rounded-lg border border-border px-3 py-1.5 text-sm font-medium text-muted-foreground hover:bg-muted"
                          >
                            <KeyRound className="h-3.5 w-3.5" />
                            PIN
                          </button>
                          <button
                            disabled={toggling === id}
                            onClick={() => handleToggleActive(u)}
                            className="flex items-center gap-1 rounded-lg border border-border px-3 py-1.5 text-sm font-medium text-muted-foreground hover:bg-muted disabled:opacity-50"
                          >
                            {toggling === id ? (
                              <Loader2 className="h-4 w-4 animate-spin" />
                            ) : u.active ? (
                              <>
                                <UserX className="h-3.5 w-3.5" />
                                Desactivar
                              </>
                            ) : (
                              <>
                                <UserCheck className="h-3.5 w-3.5" />
                                Activar
                              </>
                            )}
                          </button>
                        </div>
                      )}
                    </div>

                    {pinTarget === id && (
                      <div className="mt-3 flex items-end gap-3 rounded-lg border border-border bg-muted/40 p-3">
                        <div className="flex-1">
                          <label className={labelCls}>Nuevo PIN (4 dígitos)</label>
                          <input
                            className={cn(
                              fieldCls,
                              'font-mono tracking-widest',
                            )}
                            placeholder="••••"
                            maxLength={4}
                            inputMode="numeric"
                            type="password"
                            value={newPin}
                            onChange={(e) => setNewPin(e.target.value)}
                          />
                        </div>
                        <button
                          onClick={() => {
                            setPinTarget(null);
                            setNewPin('');
                          }}
                          className="rounded-lg border border-border px-3 py-2 text-sm hover:bg-muted"
                        >
                          Cancelar
                        </button>
                        <button
                          disabled={savingPin}
                          onClick={() => handleChangePin(id)}
                          className="flex items-center gap-1.5 rounded-lg bg-primary px-3 py-2 text-sm font-semibold text-primary-foreground hover:bg-primary/90 disabled:opacity-50"
                        >
                          {savingPin ? (
                            <Loader2 className="h-4 w-4 animate-spin" />
                          ) : null}
                          Guardar
                        </button>
                      </div>
                    )}

                    {editTarget === id && editForm && (
                      <div className="mt-3 space-y-3 rounded-lg border border-border bg-muted/40 p-3">
                        <h4 className="text-sm font-semibold">Editar usuario</h4>
                        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                          <div>
                            <label className={labelCls}>Nombre completo</label>
                            <input
                              className={fieldCls}
                              value={editForm.fullName}
                              onChange={(e) =>
                                setEditForm({
                                  ...editForm,
                                  fullName: e.target.value,
                                })
                              }
                            />
                          </div>
                          <div>
                            <label className={labelCls}>Rol</label>
                            <select
                              className={fieldCls}
                              value={editForm.role}
                              onChange={(e) =>
                                setEditForm({
                                  ...editForm,
                                  role: e.target.value as UserRole,
                                })
                              }
                            >
                              {assignable.map((r) => (
                                <option key={r} value={r}>
                                  {ROLE_LABELS[r] ?? r}
                                </option>
                              ))}
                            </select>
                          </div>
                          <div>
                            <label className={labelCls}>Estado</label>
                            <select
                              className={fieldCls}
                              value={editForm.active ? 'active' : 'inactive'}
                              onChange={(e) =>
                                setEditForm({
                                  ...editForm,
                                  active: e.target.value === 'active',
                                })
                              }
                            >
                              <option value="active">Activo</option>
                              <option value="inactive">Inactivo</option>
                            </select>
                          </div>
                          <div>
                            <label className={labelCls}>
                              Nuevo PIN (opcional)
                            </label>
                            <input
                              className={cn(
                                fieldCls,
                                'font-mono tracking-widest',
                              )}
                              placeholder="••••"
                              maxLength={4}
                              inputMode="numeric"
                              type="password"
                              value={editForm.password}
                              onChange={(e) =>
                                setEditForm({
                                  ...editForm,
                                  password: e.target.value,
                                })
                              }
                            />
                          </div>
                        </div>

                        {isOperationalRole(editForm.role) && (
                          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                            <BranchSelector
                              actorRole={actorRole}
                              branchId={editForm.branchId}
                              onBranchChange={(bid) =>
                                setEditForm({ ...editForm, branchId: bid })
                              }
                              adminBranch={adminBranch}
                            />
                          </div>
                        )}

                        {editForm.role === 'admin_pais' && isGlobalAdmin && (
                          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                            <CountrySelector
                              countryId={editForm.countryId}
                              onCountryChange={(cid) =>
                                setEditForm({ ...editForm, countryId: cid })
                              }
                            />
                          </div>
                        )}

                        <div className="flex justify-end gap-2">
                          <button
                            onClick={() => {
                              setEditTarget(null);
                              setEditForm(null);
                            }}
                            className="rounded-lg border border-border px-3 py-2 text-sm hover:bg-muted"
                          >
                            Cancelar
                          </button>
                          <button
                            disabled={savingEdit}
                            onClick={() => handleSaveEdit(id)}
                            className="flex items-center gap-1.5 rounded-lg bg-primary px-3 py-2 text-sm font-semibold text-primary-foreground hover:bg-primary/90 disabled:opacity-50"
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
                );
              })}
              {users.length === 0 && (
                <div className="py-12 text-center text-muted-foreground">
                  Sin usuarios registrados.
                </div>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
