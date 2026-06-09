import type { UserRole } from '@/types';

/** Réplica de backend/src/utils/roleCapabilities.ts — solo para UI. */
const ASSIGNABLE: Record<UserRole, ReadonlyArray<UserRole>> = {
  guardia:          [],
  jefe_operaciones: ['guardia'],
  admin:            ['guardia', 'jefe_operaciones', 'admin'],
  admin_pais:       ['guardia', 'jefe_operaciones', 'admin'],
  admin_global:     ['guardia', 'jefe_operaciones', 'admin', 'admin_pais', 'admin_global'],
};

const MANAGEABLE: Record<UserRole, ReadonlyArray<UserRole>> = {
  guardia:          [],
  jefe_operaciones: ['guardia'],
  admin:            ['guardia', 'jefe_operaciones'],
  admin_pais:       ['guardia', 'jefe_operaciones', 'admin'],
  admin_global:     ['guardia', 'jefe_operaciones', 'admin', 'admin_pais', 'admin_global'],
};

export function canAssignRole(actorRole: UserRole, targetRole: UserRole): boolean {
  return (ASSIGNABLE[actorRole] as UserRole[]).includes(targetRole);
}

export function canManageUser(actorRole: UserRole, targetRole: UserRole): boolean {
  return (MANAGEABLE[actorRole] as UserRole[]).includes(targetRole);
}

export function assignableRoles(actorRole: UserRole): UserRole[] {
  return [...ASSIGNABLE[actorRole]];
}

export const OPERATIONAL_ROLES: UserRole[] = ['guardia', 'jefe_operaciones', 'admin'];

export function isOperationalRole(role: string): boolean {
  return OPERATIONAL_ROLES.includes(role as UserRole);
}
