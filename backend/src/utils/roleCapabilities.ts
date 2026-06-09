import type { UserRole } from '../types';

// ─── Hierarchy ────────────────────────────────────────────────────────────────

// Numeric rank — higher = more privileged. Single source of truth for comparisons.
export const ROLE_RANK: Record<UserRole, number> = {
  guardia:          1,
  jefe_operaciones: 2,
  admin:            3,
  admin_pais:       4,
  admin_global:     5,
};

export const ALL_ROLES: ReadonlyArray<UserRole> = [
  'guardia',
  'jefe_operaciones',
  'admin',
  'admin_pais',
  'admin_global',
];

// ─── Assignable roles (CREATE) ────────────────────────────────────────────────

// Which roles an actor may assign when creating a new user.
//
// Rules:
//   - admin can create a peer admin (needed to bootstrap a branch team), but
//     once created that peer is managed only by admin_pais or above.
//   - admin_pais cannot create other admin_pais — that would allow country-level
//     privilege escalation across country boundaries. Only admin_global creates them.
//   - admin_global is the only one that can create admin_pais and other admin_global.
const ASSIGNABLE: Record<UserRole, ReadonlyArray<UserRole>> = {
  guardia:          [],
  jefe_operaciones: ['guardia'],
  admin:            ['guardia', 'jefe_operaciones', 'admin'],
  admin_pais:       ['guardia', 'jefe_operaciones', 'admin'],
  admin_global:     ['guardia', 'jefe_operaciones', 'admin', 'admin_pais', 'admin_global'],
};

// ─── Manageable roles (EDIT / DEACTIVATE) ────────────────────────────────────

// Which roles an actor may edit or deactivate.
//
// Rule: strictly lower rank only — peers cannot manage each other's lifecycle.
// Rationale: if two admins of the same branch could deactivate each other, a
// single compromised account could lock out the entire branch.
// Exception: admin_global manages everyone, including other admin_global (necessary
// for administrative recovery scenarios).
const MANAGEABLE: Record<UserRole, ReadonlyArray<UserRole>> = {
  guardia:          [],
  jefe_operaciones: ['guardia'],
  admin:            ['guardia', 'jefe_operaciones'],
  admin_pais:       ['guardia', 'jefe_operaciones', 'admin'],
  admin_global:     ['guardia', 'jefe_operaciones', 'admin', 'admin_pais', 'admin_global'],
};

// ─── Public helpers ───────────────────────────────────────────────────────────

export function canAssignRole(actorRole: UserRole, targetRole: UserRole): boolean {
  return (ASSIGNABLE[actorRole] as UserRole[]).includes(targetRole);
}

export function canManageUser(actorRole: UserRole, targetRole: UserRole): boolean {
  return (MANAGEABLE[actorRole] as UserRole[]).includes(targetRole);
}

export function isValidRole(value: unknown): value is UserRole {
  return typeof value === 'string' && (ALL_ROLES as string[]).includes(value);
}
