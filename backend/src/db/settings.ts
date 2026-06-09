import sql from 'mssql';
import { getConn } from './connection';
import type { TenantScope, UserRole } from '../types';
import {
  SETTINGS_REGISTRY,
  SCOPE_LEVEL_RANK,
  type SettingKey,
  type SettingLevel,
  type TypedSettings,
  isSettingKey,
  mergeWithDefaults,
  serializeSettingValue,
  assertSettingWritable,
  assertSettingOverridable,
  actorLevel,
  scopeKindToLevel,
} from '../utils/settingsRegistry';
import { AsyncLocalStorage } from 'async_hooks';

// ─── Per-request settings cache ───────────────────────────────────────────────
//
// getTypedSettings is called several times within a single request (shift
// resolution, mileage validation, dashboards). Memoizing per request — keyed by
// branchId, lifetime = the request — collapses those into a single DB read.
// The store is request-scoped via AsyncLocalStorage, so there is zero risk of
// stale data across requests; outside an HTTP request (CLI scripts) the store is
// absent and every call hits the DB.
const settingsCache = new AsyncLocalStorage<Map<number, TypedSettings>>();

/** Runs `fn` with a fresh per-request settings cache active. */
export function runWithSettingsCache<T>(fn: () => T): T {
  return settingsCache.run(new Map<number, TypedSettings>(), fn);
}

// ─── Types ────────────────────────────────────────────────────────────────────

export type SettingSource = 'default' | 'global' | 'country' | 'branch';

export interface SettingMeta {
  value:         number | boolean;
  source:        SettingSource;
  writableFrom:  SettingLevel;
  overridableTo: SettingLevel;
  /** Whether the requesting actor can edit this setting at the requested scope. */
  canEdit:       boolean;
  description:   string;
}

// ─── Internal SQL layer ───────────────────────────────────────────────────────

/**
 * Fetches only the rows that exist in the DB for the given scope (cascade),
 * each tagged with their source level.
 *
 * This is the single SQL implementation shared by all public functions.
 * It returns ONLY what's explicitly stored — defaults from the registry are
 * applied by callers via mergeWithDefaults().
 */
async function fetchDbRows(
  scope: TenantScope,
): Promise<Array<{ key: string; value: string; source: Exclude<SettingSource, 'default'> }>> {
  const req = getConn();
  let query: string;

  if (scope.kind === 'branch') {
    req.input('branchId', sql.Int, scope.branchId);
    query = `
      WITH BranchCountry AS (
        SELECT CountryId FROM Branches WHERE Id = @branchId
      )
      SELECT s.[Key] AS [key], s.Value AS value, 'branch' AS source
      FROM   Settings s
      WHERE  s.BranchId = @branchId

      UNION ALL

      SELECT s.[Key], s.Value, 'country'
      FROM   Settings s CROSS JOIN BranchCountry bc
      WHERE  s.BranchId IS NULL AND s.CountryId = bc.CountryId
        AND  s.[Key] NOT IN (
               SELECT [Key] FROM Settings WHERE BranchId = @branchId
             )

      UNION ALL

      SELECT s.[Key], s.Value, 'global'
      FROM   Settings s CROSS JOIN BranchCountry bc
      WHERE  s.BranchId IS NULL AND s.CountryId IS NULL
        AND  s.[Key] NOT IN (
               SELECT [Key] FROM Settings WHERE BranchId = @branchId
               UNION ALL
               SELECT s2.[Key] FROM Settings s2
               WHERE  s2.BranchId IS NULL AND s2.CountryId = bc.CountryId
             )
    `;
  } else if (scope.kind === 'country') {
    req.input('countryId', sql.Int, scope.countryId);
    query = `
      SELECT s.[Key] AS [key], s.Value AS value, 'country' AS source
      FROM   Settings s
      WHERE  s.BranchId IS NULL AND s.CountryId = @countryId

      UNION ALL

      SELECT s.[Key], s.Value, 'global'
      FROM   Settings s
      WHERE  s.BranchId IS NULL AND s.CountryId IS NULL
        AND  s.[Key] NOT IN (
               SELECT [Key] FROM Settings WHERE BranchId IS NULL AND CountryId = @countryId
             )
    `;
  } else {
    // global scope — only explicit global overrides
    query = `
      SELECT [Key] AS [key], Value AS value, 'global' AS source
      FROM   Settings
      WHERE  BranchId IS NULL AND CountryId IS NULL
    `;
  }

  const result = await req.query(query);
  return result.recordset as Array<{
    key: string;
    value: string;
    source: Exclude<SettingSource, 'default'>;
  }>;
}

// ─── Public: operational read ─────────────────────────────────────────────────

/**
 * Returns all settings as a fully typed object for operational code
 * (sessions, inspections, mileage checks).
 *
 * Every key in TypedSettings is always present — missing DB rows fall back
 * to registry defaults so callers never need to handle undefined.
 *
 * Usage:
 *   const settings = await getTypedSettings(session.branchId);
 *   const threshold = settings.unusually_high_mileage_threshold; // number, no parseInt needed
 */
export async function getTypedSettings(branchId: number): Promise<TypedSettings> {
  const cache = settingsCache.getStore();
  const hit   = cache?.get(branchId);
  if (hit) return hit;

  const rows     = await fetchDbRows({ kind: 'branch', branchId });
  const resolved = mergeWithDefaults(rows);
  cache?.set(branchId, resolved);
  return resolved;
}

// ─── Public: admin read ───────────────────────────────────────────────────────

/**
 * Returns settings with full metadata for the admin panel.
 *
 * Each entry includes:
 *   - value: the effective value (typed, cascade-resolved)
 *   - source: where the value came from ('default' | 'global' | 'country' | 'branch')
 *   - writableFrom: minimum scope level required to override this setting
 *   - description: human-readable description for display in the UI
 *
 * source === 'default' means no override exists at any level — the value is
 * the registry default and the actor can set an explicit override.
 */
export async function getSettingsWithMeta(
  scope:     TenantScope,
  actorRole: UserRole,
): Promise<Record<SettingKey, SettingMeta>> {
  const rows    = await fetchDbRows(scope);
  const dbIndex = new Map(rows.map(r => [r.key, r]));

  const actor       = SCOPE_LEVEL_RANK[actorLevel(actorRole)];
  const targetLevel = SCOPE_LEVEL_RANK[scopeKindToLevel(scope.kind)];

  return Object.fromEntries(
    (Object.keys(SETTINGS_REGISTRY) as SettingKey[]).map(key => {
      const def    = SETTINGS_REGISTRY[key];
      const dbRow  = dbIndex.get(key);
      const value  = dbRow
        ? (typeof def.default === 'boolean'
            ? dbRow.value === 'true'
            : Number(dbRow.value))
        : def.default;
      const source: SettingSource = dbRow ? dbRow.source : 'default';

      // Editable here = actor's role privilege is enough AND the requested scope
      // is allowed to hold an override for this key.
      const canEdit =
        actor       >= SCOPE_LEVEL_RANK[def.writableFrom] &&
        targetLevel >= SCOPE_LEVEL_RANK[def.overridableTo];

      return [key, {
        value,
        source,
        writableFrom:  def.writableFrom,
        overridableTo: def.overridableTo,
        canEdit,
        description:   def.description,
      } satisfies SettingMeta];
    }),
  ) as Record<SettingKey, SettingMeta>;
}

// ─── Exact-level read (for audit) ─────────────────────────────────────────────

/**
 * Returns the overrides that exist EXACTLY at the given scope level (no cascade).
 * Used to capture the prior value before a write so the audit log records the
 * real change at that level. Maps key → raw stored string value.
 */
export async function getOverrideAtScope(scope: TenantScope): Promise<Map<string, string>> {
  const req = getConn();
  let where: string;

  if (scope.kind === 'branch') {
    req.input('branchId', sql.Int, scope.branchId);
    where = 'BranchId = @branchId';
  } else if (scope.kind === 'country') {
    req.input('countryId', sql.Int, scope.countryId);
    where = 'BranchId IS NULL AND CountryId = @countryId';
  } else {
    where = 'BranchId IS NULL AND CountryId IS NULL';
  }

  const result = await req.query(
    `SELECT [Key] AS [key], Value AS value FROM Settings WHERE ${where}`,
  );
  return new Map(
    (result.recordset as Array<{ key: string; value: string }>).map(r => [r.key, r.value]),
  );
}

// ─── Shift order validation ───────────────────────────────────────────────────

const SHIFT_KEYS = new Set([
  'shift_morning_start',
  'shift_afternoon_start',
  'shift_night_start',
] as const satisfies ReadonlyArray<SettingKey>);

/**
 * When updating any shift boundary, validates that the resulting combination
 * still satisfies: morning < afternoon < night.
 *
 * A wrong order makes one shift unreachable (resolveShift never returns it),
 * silently mis-classifying every inspection in that window.
 */
async function assertShiftOrder(
  updatedKey: SettingKey,
  newValue:   number,
  scope:      TenantScope,
): Promise<void> {
  const rows    = await fetchDbRows(scope);
  const current = mergeWithDefaults(rows);
  const merged  = { ...current, [updatedKey]: newValue };

  if (
    !(merged.shift_morning_start < merged.shift_afternoon_start &&
      merged.shift_afternoon_start < merged.shift_night_start)
  ) {
    throw Object.assign(
      new Error(
        `Orden de turnos inválido: mañana (${merged.shift_morning_start}h) ` +
        `tarde (${merged.shift_afternoon_start}h) ` +
        `noche (${merged.shift_night_start}h). ` +
        `Debe cumplirse: mañana < tarde < noche.`,
      ),
      { statusCode: 400, code: 'INVALID_SHIFT_ORDER' },
    );
  }
}

// ─── Public: admin write ──────────────────────────────────────────────────────

/**
 * Creates or updates a setting at the actor's scope level.
 * Passing null as value DELETES the override (reverts to the inherited level).
 *
 * Enforces these invariants before writing:
 *   1. The key must exist in SETTINGS_REGISTRY (unknown keys are rejected).
 *   2. The actor's ROLE must be privileged enough for this setting's writableFrom.
 *   3. When setting a value, the TARGET SCOPE must be allowed to hold an override
 *      (overridableTo lock).
 *   4. The value must pass type + range validation.
 *   5. For shift boundary settings: morning < afternoon < night must hold.
 */
export async function upsertSetting(
  key:       string,
  value:     unknown,
  scope:     TenantScope,
  actorRole: UserRole,
): Promise<void> {
  // 1. Key must be in registry
  if (!isSettingKey(key)) {
    throw Object.assign(new Error(`Setting '${key}' is not defined in the registry.`), {
      statusCode: 400,
      code: 'UNKNOWN_SETTING',
    });
  }

  // 2. Role privilege check (independent of target scope)
  assertSettingWritable(key, actorRole);

  const req       = getConn();
  const branchId  = scope.kind === 'branch'  ? scope.branchId  : null;
  const countryId = scope.kind === 'country' ? scope.countryId : null;

  req.input('key',       sql.NVarChar(100), key);
  req.input('branchId',  sql.Int,           branchId);
  req.input('countryId', sql.Int,           countryId);

  if (value === null || value === undefined) {
    // Delete the override at this scope level — value reverts to inherited
    await req.query(`
      DELETE FROM Settings
      WHERE [Key] = @key
        AND (BranchId  = @branchId  OR (BranchId  IS NULL AND @branchId  IS NULL))
        AND (CountryId = @countryId OR (CountryId IS NULL AND @countryId IS NULL))
    `);
  } else {
    // 3. Lock check: the target scope must be allowed to hold an override
    assertSettingOverridable(key, scope);

    // 4. Validate + serialize the value according to its type definition
    const serialized = serializeSettingValue(key, value);

    // 5. Shift boundary cross-constraint: morning < afternoon < night
    if ((SHIFT_KEYS as Set<SettingKey>).has(key)) {
      await assertShiftOrder(key, Number(serialized), scope);
    }

    req.input('value', sql.NVarChar(500), serialized);

    await req.query(`
      MERGE Settings WITH (HOLDLOCK) AS target
      USING (VALUES (@key, @value)) AS source([Key], Value)
      ON    target.[Key] = source.[Key]
        AND (target.BranchId  = @branchId  OR (target.BranchId  IS NULL AND @branchId  IS NULL))
        AND (target.CountryId = @countryId OR (target.CountryId IS NULL AND @countryId IS NULL))
      WHEN MATCHED     THEN UPDATE SET Value = source.Value
      WHEN NOT MATCHED THEN INSERT ([Key], Value, BranchId, CountryId)
                            VALUES  (source.[Key], source.Value, @branchId, @countryId);
    `);
  }
}

// ─── Convenience helper ───────────────────────────────────────────────────────

/**
 * Returns a single typed setting value for a branch.
 * Useful for one-off reads without loading the full settings object.
 *
 * @example
 *   const days = await getTypedSetting('no_review_days_threshold', branchId);
 *   // days: number (no parseInt needed)
 */
export async function getTypedSetting<K extends SettingKey>(
  key:      K,
  branchId: number,
): Promise<TypedSettings[K]> {
  const settings = await getTypedSettings(branchId);
  return settings[key];
}

// ─── Re-export registry types for callers ─────────────────────────────────────

export type { SettingKey, TypedSettings, SettingLevel };
export { SETTINGS_REGISTRY, scopeKindToLevel };
