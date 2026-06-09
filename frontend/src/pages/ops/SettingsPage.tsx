import { useState, useEffect, useCallback } from 'react';
import { RotateCcw } from 'lucide-react';
import toast from 'react-hot-toast';
import type { AuthUser, SettingKey, SettingsData, SettingLevel, TargetScope } from '@/types';
import { settingsApi, type ScopeParams } from '@/api/endpoints';
import { getApiError } from '@/lib/apiError';
import { useAuth } from '@/context/AuthContext';
import { PageHeader } from '@/components/layouts/OpsShell';
import { SettingRow } from '@/components/settings/SettingRow';
import { ShiftTimesEditor } from '@/components/settings/ShiftTimesEditor';
import { ScopeBar } from '@/components/settings/ScopeBar';

// ─── Helpers de scope ─────────────────────────────────────────────────────────

function deriveInitialScope(user: AuthUser): TargetScope {
  if (user.role === 'admin_global') return { level: 'global' };
  if (user.role === 'admin_pais')   return { level: 'country', countryId: user.countryId! };
  return { level: 'branch', branchId: user.branchId! };
}

function scopeToParams(scope: TargetScope): ScopeParams {
  if (scope.level === 'global')  return { level: 'global' };
  if (scope.level === 'country') return { level: 'country', countryId: scope.countryId };
  return { level: 'branch', branchId: scope.branchId };
}

function scopeLabel(scope: TargetScope): string {
  if (scope.level === 'global')  return 'Configuración global de la organización';
  if (scope.level === 'country') return 'Configuración del país';
  return 'Configuración de la sucursal';
}

// ─── Section helper ───────────────────────────────────────────────────────────

interface SettingSectionProps {
  title:     string;
  keys:      SettingKey[];
  settings:  SettingsData;
  scopeLevel: SettingLevel;
  onSave:    (key: SettingKey, value: number | boolean | null) => Promise<void>;
  savingKey: string | null;
}

function SettingSection({ title, keys, settings, scopeLevel, onSave, savingKey }: SettingSectionProps) {
  return (
    <div className="overflow-hidden rounded-lg border border-border bg-card">
      <div className="border-b border-border bg-muted/50 px-6 py-3">
        <h2 className="text-sm font-semibold">{title}</h2>
      </div>
      {keys.map(key => (
        <SettingRow
          key={key}
          settingKey={key}
          meta={settings[key]}
          scopeLevel={scopeLevel}
          onSave={onSave}
          isSaving={savingKey === key}
        />
      ))}
    </div>
  );
}

// ─── Página principal ─────────────────────────────────────────────────────────

export function SettingsPage() {
  const { user } = useAuth();

  const [selectedScope, setSelectedScope] = useState<TargetScope>(() => deriveInitialScope(user!));
  const [settings,      setSettings]      = useState<SettingsData | null>(null);
  const [loading,       setLoading]       = useState(true);
  const [savingKey,     setSavingKey]     = useState<string | null>(null);
  const [confirmReset,  setConfirmReset]  = useState(false);
  const [bulkResetting, setBulkResetting] = useState(false);

  const scopeLevel = selectedScope.level as SettingLevel;
  const params     = scopeToParams(selectedScope);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await settingsApi.get(params);
      setSettings(res.data.data as SettingsData);
    } catch (err) {
      toast.error(getApiError(err)?.message ?? 'Error al cargar configuración.');
    } finally {
      setLoading(false);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedScope]);

  useEffect(() => { load(); }, [load]);

  async function handleSave(key: SettingKey, value: number | boolean | null) {
    setSavingKey(key);
    try {
      if (value === null) {
        await settingsApi.reset({ keys: [key] }, params);
        toast.success('Valor restablecido al heredado.');
      } else {
        await settingsApi.update({ [key]: value }, params);
        toast.success('Configuración guardada.');
      }
      await load();
    } catch (err) {
      toast.error(getApiError(err)?.message ?? 'Error al guardar.');
    } finally {
      setSavingKey(null);
    }
  }

  type ShiftKey = 'shift_morning_start' | 'shift_afternoon_start' | 'shift_night_start';

  async function handleShiftSave(updates: Partial<Record<ShiftKey, number | null>>) {
    const resetKeys = (Object.entries(updates) as [ShiftKey, number | null][])
      .filter(([, v]) => v === null)
      .map(([k]) => k);
    const valueUpdates = Object.fromEntries(
      (Object.entries(updates) as [ShiftKey, number | null][])
        .filter(([, v]) => v !== null)
    );

    setSavingKey('shift');
    try {
      if (resetKeys.length > 0) {
        await settingsApi.reset({ keys: resetKeys }, params);
      }
      if (Object.keys(valueUpdates).length > 0) {
        await settingsApi.update(valueUpdates, params);
      }
      toast.success('Horarios guardados.');
      await load();
    } catch (err) {
      toast.error(getApiError(err)?.message ?? 'Error al guardar horarios.');
    } finally {
      setSavingKey(null);
    }
  }

  async function handleBulkReset() {
    setBulkResetting(true);
    try {
      await settingsApi.reset({}, params);
      toast.success('Configuración restablecida.');
      await load();
      setConfirmReset(false);
    } catch (err) {
      toast.error(getApiError(err)?.message ?? 'Error al restablecer.');
    } finally {
      setBulkResetting(false);
    }
  }

  function handleScopeChange(scope: TargetScope) {
    setSelectedScope(scope);
    setSettings(null);
  }

  function handleScopePending() {
    setSettings(null);
  }

  const hasAnyOverride = settings
    ? Object.values(settings).some(m => m.source === scopeLevel)
    : false;

  const showScopeBar = user!.role === 'admin_pais' || user!.role === 'admin_global';

  return (
    <div className="flex h-full flex-col overflow-hidden">
      <PageHeader
        title="Configuración del sistema"
        subtitle={scopeLabel(selectedScope)}
        action={
          hasAnyOverride ? (
            <button
              onClick={() => setConfirmReset(true)}
              className="flex items-center gap-2 rounded-md border border-border px-3 py-2 text-sm text-muted-foreground hover:bg-muted hover:text-foreground"
            >
              <RotateCcw className="h-4 w-4" />
              Restablecer todo
            </button>
          ) : undefined
        }
      />

      {showScopeBar && (
        <ScopeBar
          role={user!.role}
          naturalCountryId={user!.countryId}
          selectedScope={selectedScope}
          onScopeChange={handleScopeChange}
          onScopePending={handleScopePending}
        />
      )}

      <div className="flex-1 overflow-y-auto p-6">
        {loading ? (
          <div className="flex h-32 items-center justify-center text-sm text-muted-foreground">
            Cargando configuración…
          </div>
        ) : !settings ? null : (
          <div className="mx-auto max-w-3xl space-y-6">

            <SettingSection
              title="Alertas y umbrales operativos"
              keys={['unusually_high_mileage_threshold', 'no_review_days_threshold', 'unseen_alert_hours']}
              settings={settings}
              scopeLevel={scopeLevel}
              onSave={handleSave}
              savingKey={savingKey}
            />

            {/* Horarios de turno — editor especial */}
            <div className="overflow-hidden rounded-lg border border-border bg-card">
              <div className="border-b border-border bg-muted/50 px-6 py-3">
                <h2 className="text-sm font-semibold">Horarios de turno</h2>
              </div>
              <ShiftTimesEditor
                morning={settings.shift_morning_start}
                afternoon={settings.shift_afternoon_start}
                night={settings.shift_night_start}
                scopeLevel={scopeLevel}
                onSave={handleShiftSave}
                isSaving={savingKey === 'shift'}
              />
            </div>

            <SettingSection
              title="Reportes"
              keys={['week_start_day']}
              settings={settings}
              scopeLevel={scopeLevel}
              onSave={handleSave}
              savingKey={savingKey}
            />

            <SettingSection
              title="Políticas globales"
              keys={['audit_log_retention_days', 'max_photo_size_mb']}
              settings={settings}
              scopeLevel={scopeLevel}
              onSave={handleSave}
              savingKey={savingKey}
            />

          </div>
        )}
      </div>

      {/* Modal confirmación bulk reset */}
      {confirmReset && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40">
          <div className="mx-4 w-full max-w-sm rounded-xl border border-border bg-card p-6 shadow-xl">
            <h2 className="mb-2 text-base font-semibold">¿Restablecer toda la configuración?</h2>
            <p className="mb-6 text-sm text-muted-foreground">
              Se eliminarán todos los ajustes de este nivel y los valores volverán a los heredados
              del nivel superior.
            </p>
            <div className="flex justify-end gap-3">
              <button
                onClick={() => setConfirmReset(false)}
                disabled={bulkResetting}
                className="rounded-md border border-border px-4 py-2 text-sm hover:bg-muted disabled:opacity-50"
              >
                Cancelar
              </button>
              <button
                onClick={handleBulkReset}
                disabled={bulkResetting}
                className="rounded-md bg-red-600 px-4 py-2 text-sm text-white hover:bg-red-700 disabled:opacity-50"
              >
                {bulkResetting ? 'Restableciendo…' : 'Sí, restablecer todo'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
