import { AppError } from '../middleware/errorHandler';
import type { TenantScope, UserRole } from '../types';

// ─── Level hierarchy ──────────────────────────────────────────────────────────

export type SettingLevel = 'branch' | 'country' | 'global';

// Privilege rank: higher = more privileged (broader scope).
// Used to enforce the writableFrom / overridableTo constraints at write time.
export const SCOPE_LEVEL_RANK: Record<SettingLevel, number> = {
  branch:  0,
  country: 1,
  global:  2,
};

export function scopeKindToLevel(kind: TenantScope['kind']): SettingLevel {
  if (kind === 'global')  return 'global';
  if (kind === 'country') return 'country';
  return 'branch';
}

// The setting level that corresponds to an actor's ROLE privilege.
// This is independent of the target scope of a write: an admin_global writing a
// branch override still acts with 'global' privilege.
export function actorLevel(role: UserRole): SettingLevel {
  if (role === 'admin_global') return 'global';
  if (role === 'admin_pais')   return 'country';
  return 'branch'; // admin (lower roles never reach the write path)
}

// ─── Definition shapes ────────────────────────────────────────────────────────

type BaseDef = {
  // Minimum ROLE privilege required to change this setting (authorization).
  writableFrom: SettingLevel;
  // Lowest scope level at which an override row may exist (data shape / lock).
  //   'branch'  → full cascade: any contained scope may override (default)
  //   'country' → uniform per country: branches cannot override
  //   'global'  → uniform org-wide: nobody may override below global
  // Invariant: rank(writableFrom) >= rank(overridableTo). Validated at boot.
  overridableTo: SettingLevel;
  description:   string;
};

type NumberDef = BaseDef & {
  type:    'number';
  default: number;
  min?:    number;
  max?:    number;
};

type BooleanDef = BaseDef & {
  type:    'boolean';
  default: boolean;
};

export type SettingDefinition = NumberDef | BooleanDef;

// ─── Registry ─────────────────────────────────────────────────────────────────
//
// This is the single source of truth for every configurable parameter in the system.
//
// Adding a new setting:
//   1. Add an entry here with its type, default, writableFrom, and description.
//   2. Done. No DB migration, no seed changes, no other files to touch.
//      The new setting is immediately available with its default value everywhere.
//
// Two orthogonal axes govern every setting:
//
// writableFrom — minimum admin ROLE privilege that can change it (authorization):
//   'branch'  → admin, admin_pais, admin_global
//   'country' → admin_pais, admin_global
//   'global'  → admin_global only
//
// overridableTo — lowest scope level where a value may live (data shape / lock):
//   'branch'  → full cascade (branch may override country may override global)
//   'country' → uniform per country (no branch overrides allowed)
//   'global'  → uniform org-wide (no country/branch overrides allowed)

export const SETTINGS_REGISTRY = {
  // ── Inspection thresholds ────────────────────────────────────────────────
  unusually_high_mileage_threshold: {
    type:          'number',
    default:       500,
    min:           1,
    max:           9_999,
    writableFrom:  'branch',
    overridableTo: 'branch',
    description:   'Kilómetros/día máximo antes de mostrar alerta de kilometraje inusual.',
  },
  no_review_days_threshold: {
    type:          'number',
    default:       3,
    min:           1,
    max:           365,
    writableFrom:  'branch',
    overridableTo: 'branch',
    description:   'Días sin revisión antes de mostrar alerta de vehículo sin revisar.',
  },
  // ── Soft completeness monitor (modelo stream v2.0) ────────────────────────
  //  Reemplaza el viejo gate de "no enviar con pendientes". En lugar de
  //  bloquear al guardia, el sistema marca para el jefe los vehículos 'active'
  //  sin inspección en las últimas N horas.
  unseen_alert_hours: {
    type:          'number',
    default:       8,
    min:           1,
    max:           168,
    writableFrom:  'branch',
    overridableTo: 'branch',
    description:   'Horas sin inspección antes de marcar un vehículo activo como "no visto" en el monitor de supervisión.',
  },
  // ── Shift boundaries (country-level policy) ──────────────────────────────
  //  Each shift spans from its start (inclusive) to the next start (exclusive).
  //  Night wraps midnight: [shift_night_start, shift_morning_start).
  //  Shift schedules are operational policy per country, uniform across its
  //  branches: writableFrom + overridableTo = 'country' (no per-branch override).
  shift_morning_start: {
    type:          'number',
    default:       6,
    min:           0,
    max:           23,
    writableFrom:  'country',
    overridableTo: 'country',
    description:   'Hora local de inicio del turno mañana (formato 24h, 0–23).',
  },
  shift_afternoon_start: {
    type:          'number',
    default:       14,
    min:           0,
    max:           23,
    writableFrom:  'country',
    overridableTo: 'country',
    description:   'Hora local de inicio del turno tarde (formato 24h, 0–23).',
  },
  shift_night_start: {
    type:          'number',
    default:       22,
    min:           0,
    max:           23,
    writableFrom:  'country',
    overridableTo: 'country',
    description:   'Hora local de inicio del turno noche (formato 24h, 0–23).',
  },
  // ── Organization-wide policy (global-locked) ─────────────────────────────
  //  Uniform across the whole organization: only admin_global writes it and no
  //  country/branch override is permitted (overridableTo: 'global').
  audit_log_retention_days: {
    type:          'number',
    default:       365,
    min:           30,
    max:           3_650,
    writableFrom:  'global',
    overridableTo: 'global',
    description:   'Días que se conservan los registros de auditoría antes de poder depurarse.',
  },
  // ── Upload limits (global default, país puede ajustar) ────────────────────
  max_photo_size_mb: {
    type:          'number',
    default:       10,
    min:           1,
    max:           50,
    writableFrom:  'global',
    overridableTo: 'country',
    description:   'Tamaño máximo (MB) por foto subida en una inspección.',
  },
  // ── Reporting (country-level policy) ─────────────────────────────────────
  week_start_day: {
    type:          'number',
    default:       1,
    min:           0,
    max:           6,
    writableFrom:  'country',
    overridableTo: 'country',
    description:   'Primer día de la semana para agrupar reportes (0=domingo … 6=sábado).',
  },
} as const satisfies Record<string, SettingDefinition>;

// ─── Boot-time invariant check ──────────────────────────────────────────────
//
// A setting can never be overridable below the level required to write it
// (rank(writableFrom) >= rank(overridableTo)) — otherwise a scope could legally
// hold a value that no admin is privileged to set. Fail fast at startup.
(function validateRegistry() {
  for (const [key, def] of Object.entries(SETTINGS_REGISTRY)) {
    if (SCOPE_LEVEL_RANK[def.writableFrom] < SCOPE_LEVEL_RANK[def.overridableTo]) {
      throw new Error(
        `[settings] Registro inválido para '${key}': writableFrom='${def.writableFrom}' ` +
        `no puede ser menor que overridableTo='${def.overridableTo}'.`,
      );
    }
  }
})();

// ─── Derived types ────────────────────────────────────────────────────────────

export type SettingKey = keyof typeof SETTINGS_REGISTRY;

// Map each key to its proper TypeScript value type (number | boolean).
// Example: TypedSettings['shift_morning_start'] → number
//          TypedSettings['require_photo_on_damage'] → boolean
type ValueOf<D extends SettingDefinition> =
  D extends { type: 'number' }  ? number  :
  D extends { type: 'boolean' } ? boolean :
  never;

export type TypedSettings = {
  [K in SettingKey]: ValueOf<(typeof SETTINGS_REGISTRY)[K]>
};

// ─── Runtime helpers ──────────────────────────────────────────────────────────

export function isSettingKey(key: string): key is SettingKey {
  return key in SETTINGS_REGISTRY;
}

/**
 * Type guard que estrecha una definición a BooleanDef. Vive como función con el
 * parámetro tipado al union completo (SettingDefinition) para que la
 * discriminación por `type` compile aunque el registry actual no tenga ninguna
 * setting booleana — el soporte booleano queda disponible si se agrega una en el
 * futuro, sin reintroducir las que se eliminaron.
 */
function isBooleanDef(def: SettingDefinition): def is BooleanDef {
  return def.type === 'boolean';
}

/**
 * Devuelve la definición de una clave tipada al union completo (SettingDefinition).
 * El `as const` del registry estrecha cada entrada a su literal exacto; cuando no
 * hay settings booleanas eso colapsa el tipo a NumberDef y el type guard
 * estrecharía a `never`. El límite de función ensancha el tipo de forma confiable.
 */
function defOf(key: SettingKey): SettingDefinition {
  return SETTINGS_REGISTRY[key];
}

/**
 * Parses a raw string stored in the DB into the correct TypeScript value.
 * On invalid data (corrupted DB row), logs a warning and returns the registry
 * default rather than crashing — operational code must never fail due to a
 * bad settings row.
 */
export function parseSettingValue(key: SettingKey, raw: string): number | boolean {
  const def = defOf(key);

  if (isBooleanDef(def)) {
    if (raw === 'true')  return true;
    if (raw === 'false') return false;
    console.warn(`[settings] Corrupt boolean value "${raw}" for key "${key}" — using default ${def.default}`);
    return def.default;
  }

  const n = Number(raw);
  if (!Number.isFinite(n)) {
    console.warn(`[settings] Corrupt number value "${raw}" for key "${key}" — using default ${def.default}`);
    return def.default;
  }
  return Math.round(n);
}

/**
 * Validates and serializes a client-supplied value for storage in the DB.
 * Throws AppError 400 with a human-readable message on any validation failure.
 * Returns the string representation to store in the Value column.
 */
export function serializeSettingValue(key: SettingKey, value: unknown): string {
  const def = defOf(key);

  if (isBooleanDef(def)) {
    if (typeof value !== 'boolean') {
      throw new AppError(400, 'INVALID_SETTING_VALUE',
        `'${key}' debe ser un booleano (true o false).`,
      );
    }
    return String(value);
  }

  // number
  const n = typeof value === 'string' ? Number(value) : value as number;
  if (typeof n !== 'number' || !Number.isFinite(n) || !Number.isInteger(n)) {
    throw new AppError(400, 'INVALID_SETTING_VALUE',
      `'${key}' debe ser un número entero.`,
    );
  }
  const numDef = def as NumberDef;
  if (numDef.min !== undefined && n < numDef.min) {
    throw new AppError(400, 'INVALID_SETTING_VALUE',
      `'${key}' debe ser mayor o igual a ${numDef.min}.`,
    );
  }
  if (numDef.max !== undefined && n > numDef.max) {
    throw new AppError(400, 'INVALID_SETTING_VALUE',
      `'${key}' debe ser menor o igual a ${numDef.max}.`,
    );
  }
  return String(n);
}

/**
 * Asserts that the actor's ROLE is privileged enough to change the setting.
 * This is independent of the target scope — an admin_global writing a branch
 * override still acts with 'global' privilege.
 * Throws AppError 403 if the actor's role level is below writableFrom.
 */
export function assertSettingWritable(key: SettingKey, actorRole: UserRole): void {
  const def   = SETTINGS_REGISTRY[key];
  const level = actorLevel(actorRole);

  if (SCOPE_LEVEL_RANK[level] < SCOPE_LEVEL_RANK[def.writableFrom]) {
    throw new AppError(
      403,
      'SETTING_NOT_WRITABLE',
      `'${key}' requiere privilegio mínimo de ${def.writableFrom}. Tu nivel: ${level}.`,
    );
  }
}

/** Non-throwing predicate version of assertSettingWritable (for filtering). */
export function canWriteSetting(actorRole: UserRole, key: SettingKey): boolean {
  return SCOPE_LEVEL_RANK[actorLevel(actorRole)] >= SCOPE_LEVEL_RANK[SETTINGS_REGISTRY[key].writableFrom];
}

/**
 * Asserts that the target scope is allowed to HOLD an override for this setting.
 * Enforces the lock: a setting with overridableTo='country' rejects branch-level
 * overrides; overridableTo='global' rejects country/branch overrides.
 * Throws AppError 403 if the target level is below overridableTo.
 */
export function assertSettingOverridable(key: SettingKey, targetScope: TenantScope): void {
  const def         = SETTINGS_REGISTRY[key];
  const targetLevel = scopeKindToLevel(targetScope.kind);

  if (SCOPE_LEVEL_RANK[targetLevel] < SCOPE_LEVEL_RANK[def.overridableTo]) {
    throw new AppError(
      403,
      'SETTING_NOT_OVERRIDABLE',
      `'${key}' no admite override a nivel ${targetLevel}: se fija de forma uniforme desde nivel ${def.overridableTo} hacia abajo.`,
    );
  }
}

/**
 * Builds a fully resolved TypedSettings object by merging DB rows (overrides)
 * with registry defaults (used for any key not present in dbRows).
 *
 * This guarantees the returned object always has every key in TypedSettings,
 * regardless of what's in the DB.
 */
export function mergeWithDefaults(
  dbRows: ReadonlyArray<{ key: string; value: string }>,
): TypedSettings {
  const override = new Map(dbRows.map(r => [r.key, r.value]));

  return Object.fromEntries(
    (Object.keys(SETTINGS_REGISTRY) as SettingKey[]).map(key => {
      const raw    = override.get(key);
      const parsed = raw !== undefined
        ? parseSettingValue(key, raw)
        : SETTINGS_REGISTRY[key].default;
      return [key, parsed];
    }),
  ) as TypedSettings;
}
