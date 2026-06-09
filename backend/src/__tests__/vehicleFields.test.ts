/**
 * Unit tests for parseInitialMileage — the initial-odometer validator
 * (PENDIENTE-04). Pure logic, no mocks, no app import.
 */
import { parseInitialMileage, MAX_INITIAL_MILEAGE } from '../utils/vehicleFields';

describe('parseInitialMileage', () => {
  describe('defaults to 0 for absent / empty input', () => {
    it.each([undefined, null, ''])('returns 0 for %j', (v) => {
      expect(parseInitialMileage(v)).toBe(0);
    });
  });

  describe('accepts valid non-negative integers (number or numeric string)', () => {
    const cases: Array<[unknown, number]> = [
      [0, 0],
      [1, 1],
      [50000, 50000],
      ['0', 0],
      ['50000', 50000],
      ['  42 ', 42], // surrounding whitespace tolerated
      [MAX_INITIAL_MILEAGE, MAX_INITIAL_MILEAGE],
    ];
    it.each(cases)('parseInitialMileage(%j) === %j', (input, expected) => {
      expect(parseInitialMileage(input)).toBe(expected);
    });
  });

  describe('rejects invalid values with null (→ 400 at the route)', () => {
    const cases: Array<[string, unknown]> = [
      ['negative number',    -1],
      ['negative string',    '-5000'],
      ['above MAX',          MAX_INITIAL_MILEAGE + 1],
      ['far above MAX',      9_999_999_999],
      ['decimal number',     100.5],
      ['decimal string',     '100.5'],
      ['non-numeric string', 'cien mil'],
      ['NaN literal',        NaN],
      ['Infinity',           Infinity],
      ['-Infinity',          -Infinity],
      ['boolean true',       true],
      ['boolean false',      false],
      ['object',             { km: 1 }],
      ['array',              [100]],
    ];
    it.each(cases)('returns null for %s', (_label, value) => {
      expect(parseInitialMileage(value)).toBeNull();
    });
  });

  it('rejects parseInt-style trailing garbage (uses Number, not parseInt)', () => {
    // parseInt('100km') === 100 would silently accept; Number('100km') is NaN.
    expect(parseInitialMileage('100km')).toBeNull();
  });
});
