import type { Shift } from '../types';

/**
 * Lightweight timezone helpers built on the runtime's Intl/ICU — no moment,
 * luxon or date-fns-tz. IANA timezone names (e.g. "America/Guatemala") carry
 * their own DST rules, so the runtime handles offset/DST for us.
 */

/**
 * Returns the calendar date ("YYYY-MM-DD") it currently is at `instant`
 * as seen from `timeZone`.
 *
 * Pure function (no DB, no deps) — testable in isolation.
 *
 * @example
 *   const t = new Date('2026-06-04T01:00:00Z');
 *   getDateInTimezone(t, 'America/Guatemala'); // "2026-06-03" (19:00 local)
 */
export function getDateInTimezone(instant: Date, timeZone: string): string {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone,
    year:  'numeric',
    month: '2-digit',
    day:   '2-digit',
  }).formatToParts(instant);

  const get = (type: string) => parts.find(p => p.type === type)!.value;
  return `${get('year')}-${get('month')}-${get('day')}`;
}

/**
 * Returns the current local hour (0-23) in the given IANA timezone.
 * Used by resolveShift to determine which shift is active right now.
 *
 * Pure function — testable in isolation.
 */
export function getHourInTimezone(instant: Date, timeZone: string): number {
  const hourStr = new Intl.DateTimeFormat('en', {
    timeZone,
    hour:   'numeric',
    hour12: false,
  }).format(instant);
  // Intl returns "24" at midnight in some runtimes — normalize to 0.
  const h = parseInt(hourStr, 10);
  return h === 24 ? 0 : h;
}

/**
 * Determines which shift is currently active based on the local hour and
 * the configured shift boundaries.
 *
 * Accepts a TypedSettings object — shift starts are already integers,
 * no parsing needed. Falls back to registry defaults if called with a
 * partial object (useful in tests).
 *
 * Each shift spans from its start (inclusive) to the next start (exclusive).
 * Night wraps midnight: [shift_night_start, shift_morning_start).
 *
 * Pure function — testable in isolation.
 */
export function resolveShift(
  localHour: number,
  settings: {
    shift_morning_start:   number;
    shift_afternoon_start: number;
    shift_night_start:     number;
  },
): Shift {
  const { shift_morning_start: morn, shift_afternoon_start: aftn, shift_night_start: nite } = settings;

  if (localHour >= morn && localHour < aftn) return 'morning';
  if (localHour >= aftn && localHour < nite) return 'afternoon';
  return 'night';
}

/**
 * Returns the OPERATIONAL date for a shift event — i.e., the calendar day on
 * which the shift STARTED, not necessarily the wall-clock date at the moment
 * of registration.
 *
 * The night shift spans [shift_night_start, shift_morning_start) and crosses
 * midnight. Any event recorded between midnight and shift_morning_start still
 * belongs to the night that started the previous calendar day.
 *
 * Example:
 *   Registration at 01:00 on 2026-06-04 (night shift, morningStart = 6)
 *   → operationalDate = "2026-06-03"  (the night started on June 3rd)
 *
 * Pure function — testable in isolation.
 */
export function getOperationalDate(
  localDate:   string,
  shift:       Shift,
  localHour:   number,
  morningStart: number,
): string {
  if (shift === 'night' && localHour < morningStart) {
    const d = new Date(`${localDate}T00:00:00Z`);
    d.setUTCDate(d.getUTCDate() - 1);
    return d.toISOString().slice(0, 10);
  }
  return localDate;
}
