// Shared test helpers — reusable across controller suites.
//
// authCookie   mints a REAL signed vi_token (jsonwebtoken not mocked) so
//              cookie-based auth is exercised end-to-end.
// userRow      builds a UserRow shaped exactly like db/users for findUserByUsername mocks.
// vehicleRow   builds a Vehicle shaped exactly like db/vehicles.
// inspectionRow builds an Inspection shaped exactly like db/inspections.
// issueRow     builds an OpenIssue shaped exactly like db/issues.
// defaultSettings returns a typed settings object matching the TypedSettings interface.

import jwt from 'jsonwebtoken';
import type { AuthPayload } from '../types';
import type { UserRow } from '../db/users';
import type { Vehicle, Inspection, OpenIssue } from '../types';

// ─── Auth ────────────────────────────────────────────────────────────────────

/**
 * Returns a `Cookie` header value (`vi_token=<jwt>`) for a given payload.
 * Pass jwt sign options to forge edge cases, e.g. `{ expiresIn: '-10s' }` for
 * an already-expired token.
 */
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

/** Cookie pre-built for the most common supervisor role used in tests. */
export function supervisorCookie(overrides: Partial<AuthPayload> = {}): string {
  return authCookie({ userId: '2', username: 'jefe1', role: 'jefe_operaciones', fullName: 'Jefe Ops', branchId: 1, ...overrides });
}

/** Builds a complete UserRow; override any field per test. */
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

/**
 * Builds a complete Inspection record. Defaults are tuned to the "current
 * shift" (localDate='2026-06-09', shift='morning') so the inspection is NOT
 * sealed by default. Override localDate or shift to make it sealed.
 */
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

// ─── Settings ────────────────────────────────────────────────────────────────

/**
 * A TypedSettings object that matches what getTypedSettings returns.
 * All fields used by inspectionController and mileageService are present.
 */
export function defaultSettings(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    shift_morning_start:               6,
    shift_afternoon_start:             14,
    shift_night_start:                 22,
    no_review_days_threshold:          3,
    unusually_high_mileage_threshold:  500,
    ...overrides,
  };
}
