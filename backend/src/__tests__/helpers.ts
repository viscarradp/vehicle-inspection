// Shared test helpers — reusable across controller suites.
import jwt from 'jsonwebtoken';
import type { AuthPayload, Vehicle, Inspection, OpenIssue, Driver, VehicleStatusType, AuditLog } from '../types';
import type { UserRow } from '../db/users';
import type { BranchRow } from '../db/branches';

// ─── Auth ────────────────────────────────────────────────────────────────────

export function authCookie(
  payload: Partial<AuthPayload> = {},
  opts: jwt.SignOptions = {},
): string {
  const full: AuthPayload = {
    userId:   '1',
    username: 'guard1',
    role:     'guardia',
    fullName: 'Guard One',
    branchId: 1,
    ...payload,
  };
  const token = jwt.sign(full, process.env.JWT_SECRET as string, { expiresIn: '12h', ...opts });
  return `vi_token=${token}`;
}

export function supervisorCookie(overrides: Partial<AuthPayload> = {}): string {
  return authCookie({ userId: '2', username: 'jefe1', role: 'jefe_operaciones', fullName: 'Jefe Ops', branchId: 1, ...overrides });
}

// ─── Users ────────────────────────────────────────────────────────────────────

export function userRow(overrides: Partial<UserRow> = {}): UserRow {
  return {
    id:           1,
    username:     'guard1',
    fullName:     'Guard One',
    role:         'guardia',
    active:       true,
    passwordHash: '$2a$12$placeholderhashplaceholderhashplaceholderhashpl',
    branchId:     1,
    countryId:    1,
    lastLogin:    null,
    createdAt:    '2026-01-01T00:00:00.000Z',
    updatedAt:    '2026-01-01T00:00:00.000Z',
    ...overrides,
  };
}

/** User profile without passwordHash (shape returned by admin list/get). */
export function userProfileRow(overrides: Partial<Omit<UserRow, 'passwordHash'>> = {}) {
  return {
    id:        2,
    username:  'jefe1',
    fullName:  'Jefe Ops',
    role:      'jefe_operaciones' as const,
    active:    true,
    branchId:  1,
    countryId: 1,
    lastLogin: null,
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
    ...overrides,
  };
}

// ─── Vehicles ────────────────────────────────────────────────────────────────

export function vehicleRow(overrides: Partial<Vehicle> = {}): Vehicle {
  return {
    id:             '10',
    branchId:       1,
    plate:          'ABC-123',
    vehicleType:    'Pickup',
    brand:          'Toyota',
    model:          'Hilux',
    year:           2022,
    active:         true,
    initialMileage: 0,
    lastMileage:    50000,
    hasOpenIssues:  false,
    currentStatus:  'active',
    createdAt:      '2026-01-01T00:00:00.000Z',
    updatedAt:      '2026-01-01T00:00:00.000Z',
    ...overrides,
  };
}

// ─── Inspections ─────────────────────────────────────────────────────────────

export function inspectionRow(overrides: Partial<Inspection> = {}): Inspection {
  return {
    id:                      '100',
    branchId:                1,
    vehicleId:               '10',
    plate:                   'ABC-123',
    localDate:               '2026-06-09',
    shift:                   'morning',
    direction:               'entry',
    guardId:                 '1',
    guardName:               'Guard One',
    returnStatus:            'received',
    status:                  'reviewed_ok',
    lifecycleStatus:         'final',
    mileage:                 51000,
    previousMileage:         50000,
    mileageDifference:       1000,
    mileageWarningType:      'none',
    mileageWarningConfirmed: false,
    fuelLevel:               'full',
    cleanlinessStatus:       'clean',
    toolsGeneralStatus:      'ok',
    exteriorGeneralStatus:   'ok',
    interiorGeneralStatus:   'ok',
    generalObservation:      '',
    hasNewIssue:             false,
    hasPhotos:               false,
    createdBy:               '1',
    createdAt:               '2026-06-09T10:00:00.000Z',
    updatedAt:               '2026-06-09T10:00:00.000Z',
    modifiedAfterSeal:       false,
    ...overrides,
  };
}

// ─── Open Issues ─────────────────────────────────────────────────────────────

export function issueRow(overrides: Partial<OpenIssue> = {}): OpenIssue {
  return {
    id:           '200',
    vehicleId:    '10',
    branchId:     1,
    plate:        'ABC-123',
    inspectionId: '100',
    issueType:    'damage',
    description:  'Daño en puerta delantera',
    severity:     'medium',
    status:       'open',
    detectedBy:   'Guard One',
    detectedAt:   '2026-06-09T10:00:00.000Z',
    ...overrides,
  };
}

// ─── Branches ────────────────────────────────────────────────────────────────

export function branchRow(overrides: Partial<BranchRow> = {}): BranchRow {
  return {
    id:        1,
    countryId: 1,
    code:      'SUC01',
    name:      'Sucursal Principal',
    address:   'Av. Principal 123',
    active:    true,
    ...overrides,
  };
}

// ─── Drivers ─────────────────────────────────────────────────────────────────

export function driverRow(overrides: Partial<Driver> = {}): Driver {
  return {
    id:         '5',
    branchId:   1,
    name:       'Juan Pérez',
    department: 'Logística',
    active:     true,
    createdAt:  '2026-01-01T00:00:00.000Z',
    ...overrides,
  };
}

// ─── VehicleStatusType ───────────────────────────────────────────────────────

export function vehicleStatusTypeRow(overrides: Partial<VehicleStatusType> = {}): VehicleStatusType {
  return {
    id:        1,
    key:       'workshop',
    labelEs:   'En taller',
    color:     'orange',
    countryId: 1,
    isSystem:  false,
    active:    true,
    sortOrder: 1,
    ...overrides,
  };
}

// ─── Countries ───────────────────────────────────────────────────────────────

export interface CountryRow {
  id: number; code: string; name: string; timezone: string; active: boolean;
}
export function countryRow(overrides: Partial<CountryRow> = {}): CountryRow {
  return { id: 1, code: 'GT', name: 'Guatemala', timezone: 'America/Guatemala', active: true, ...overrides };
}

// ─── Audit Log ───────────────────────────────────────────────────────────────

export function auditLogRow(overrides: Partial<AuditLog> = {}): AuditLog {
  return {
    id:        '300',
    userId:    '2',
    userName:  'Jefe Ops',
    action:    'UPDATE_SETTING',
    entity:    'Setting',
    entityId:  'no_review_days_threshold',
    timestamp: '2026-06-09T10:00:00.000Z',
    ...overrides,
  };
}

// ─── Settings ────────────────────────────────────────────────────────────────

export function defaultSettings(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    shift_morning_start:              6,
    shift_afternoon_start:            14,
    shift_night_start:                22,
    no_review_days_threshold:         3,
    unusually_high_mileage_threshold: 500,
    ...overrides,
  };
}
