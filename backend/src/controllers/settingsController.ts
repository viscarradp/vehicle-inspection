import { Request, Response, NextFunction } from 'express';
import { AppError } from '../middleware/errorHandler';
import { targetScopeFromRequest, assertCanAccessScope } from '../middleware/tenantScope';
import { getSettingsWithMeta, upsertSetting, getOverrideAtScope } from '../db/settings';
import { createAuditLog } from '../db/audit';
import {
  SETTINGS_REGISTRY,
  isSettingKey,
  parseSettingValue,
  canWriteSetting,
  type SettingKey,
} from '../utils/settingsRegistry';
import type { TenantScope } from '../types';

// ─── Helpers ──────────────────────────────────────────────────────────────────

/** Best-effort client IP for the audit trail (honours a reverse proxy). */
function clientIp(req: Request): string {
  const fwd = req.headers['x-forwarded-for'];
  if (typeof fwd === 'string' && fwd.length) return fwd.split(',')[0].trim();
  return req.socket?.remoteAddress ?? '';
}

/** branchId is only meaningful for the audit row when the target is a branch. */
function auditBranchId(scope: TenantScope): number | undefined {
  return scope.kind === 'branch' ? scope.branchId : undefined;
}

/** countryId stamps country/global-targeted audit rows so they stay scopable. */
function auditCountryId(scope: TenantScope): number | undefined {
  return scope.kind === 'country' ? scope.countryId : undefined;
}

/** Compact human-readable scope label stored alongside the audit value. */
function scopeLabel(scope: TenantScope): string {
  if (scope.kind === 'global')  return 'global';
  if (scope.kind === 'country') return `country:${scope.countryId}`;
  return `branch:${scope.branchId}`;
}

/** Parses the prior raw override (if any) into its typed value, else null. */
function priorValue(key: SettingKey, before: Map<string, string>): number | boolean | null {
  const raw = before.get(key);
  return raw !== undefined ? parseSettingValue(key, raw) : null;
}

// ─── GET /settings ──────────────────────────────────────────────────────────

export async function getSettings(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const scope = targetScopeFromRequest(req);
    await assertCanAccessScope(req.user!, scope, 'read');

    const settings = await getSettingsWithMeta(scope, req.user!.role);
    res.json({
      success:    true,
      statusCode: 'OK',
      message:    'Configuración.',
      uiState:    'saved_successfully',
      data:       settings,
    });
  } catch (err) { next(err); }
}

// ─── PUT /settings ──────────────────────────────────────────────────────────
// Body: { key: value | null }. null deletes the override at this scope (revert
// to inherited). All keys validated upfront — all-or-nothing.

export async function updateSettings(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const scope = targetScopeFromRequest(req);
    await assertCanAccessScope(req.user!, scope, 'write');

    const updates = req.body as Record<string, unknown>;
    if (!updates || typeof updates !== 'object' || Array.isArray(updates)) {
      throw new AppError(400, 'INVALID_BODY', 'El cuerpo debe ser un objeto { clave: valor }.');
    }
    const keys = Object.keys(updates);
    if (keys.length === 0) {
      throw new AppError(400, 'INVALID_BODY', 'No se enviaron parámetros para actualizar.');
    }
    for (const key of keys) {
      if (!isSettingKey(key)) {
        throw new AppError(400, 'UNKNOWN_SETTING',
          `'${key}' no es un parámetro de configuración válido. Valores aceptados: ${Object.keys(SETTINGS_REGISTRY).join(', ')}.`,
        );
      }
    }

    // Snapshot exact-level overrides so the audit log records the real prior value.
    const before    = await getOverrideAtScope(scope);
    const ip        = clientIp(req);
    const branchId  = auditBranchId(scope);
    const countryId = auditCountryId(scope);
    const label     = scopeLabel(scope);

    for (const key of keys as SettingKey[]) {
      const value   = updates[key] ?? null;
      const isReset = value === null;

      await upsertSetting(key, value, scope, req.user!.role);

      await createAuditLog({
        userId:    req.user!.userId,
        userName:  req.user!.fullName,
        action:    isReset ? 'RESET_SETTING' : 'UPDATE_SETTING',
        entity:    'Setting',
        entityId:  key,
        oldValue:  { scope: label, value: priorValue(key, before) },
        newValue:  { scope: label, value: isReset ? null : value },
        branchId,
        countryId,
        ipAddress: ip,
      });
    }

    res.json({
      success:    true,
      statusCode: 'SETTINGS_UPDATED',
      message:    `${keys.length} parámetro(s) actualizado(s).`,
      uiState:    'saved_successfully',
    });
  } catch (err) { next(err); }
}

// ─── POST /settings/reset ─────────────────────────────────────────────────────
// Body: { keys?: string[] }. Deletes overrides at the target scope so values
// revert to the inherited level. Omitting `keys` resets every override that
// exists at this scope and that the actor is privileged to change.

export async function resetSettings(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const scope = targetScopeFromRequest(req);
    await assertCanAccessScope(req.user!, scope, 'write');

    const before   = await getOverrideAtScope(scope);
    const body      = (req.body ?? {}) as { keys?: unknown };
    let   targetKeys: SettingKey[];

    if (body.keys === undefined) {
      // Reset-all: only keys with an existing override here that the actor may write.
      targetKeys = [...before.keys()]
        .filter(isSettingKey)
        .filter(k => canWriteSetting(req.user!.role, k));
    } else {
      if (!Array.isArray(body.keys)) {
        throw new AppError(400, 'INVALID_BODY', "'keys' debe ser un arreglo de claves.");
      }
      for (const k of body.keys) {
        if (typeof k !== 'string' || !isSettingKey(k)) {
          throw new AppError(400, 'UNKNOWN_SETTING', `'${String(k)}' no es un parámetro de configuración válido.`);
        }
      }
      targetKeys = body.keys as SettingKey[];
    }

    const ip        = clientIp(req);
    const branchId  = auditBranchId(scope);
    const countryId = auditCountryId(scope);
    const label     = scopeLabel(scope);
    let   resetCount = 0;

    for (const key of targetKeys) {
      // upsertSetting(null) validates writableFrom and deletes the override.
      await upsertSetting(key, null, scope, req.user!.role);

      // Only audit keys that actually had an override at this level.
      if (before.has(key)) {
        resetCount++;
        await createAuditLog({
          userId:    req.user!.userId,
          userName:  req.user!.fullName,
          action:    'RESET_SETTING',
          entity:    'Setting',
          entityId:  key,
          oldValue:  { scope: label, value: priorValue(key, before) },
          newValue:  { scope: label, value: null },
          branchId,
          countryId,
          ipAddress: ip,
        });
      }
    }

    res.json({
      success:    true,
      statusCode: 'SETTINGS_RESET',
      message:    `${resetCount} override(s) eliminado(s); revertido(s) al nivel heredado.`,
      uiState:    'saved_successfully',
    });
  } catch (err) { next(err); }
}
