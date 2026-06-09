// Unit tests — services/mileageService.ts
//
// determineMileageWarningType: pure synchronous function — no mocks needed.
// validateMileage:             async — mocks getTypedSettings only.
//
// No HTTP / Supertest. These tests call the functions directly and verify
// the output shape and business rules in isolation.

import { determineMileageWarningType, validateMileage } from '../services/mileageService';

// ─── Mocks ───────────────────────────────────────────────────────────────────

jest.mock('../db/settings', () => ({
  getTypedSettings:     jest.fn(),
  runWithSettingsCache: (_next: any) => _next(),
}));

import { getTypedSettings } from '../db/settings';
const mockGetTypedSettings = getTypedSettings as jest.Mock;

// ─── determineMileageWarningType (pure, no mocks) ────────────────────────────

describe('determineMileageWarningType — pure logic', () => {

  // ── none: normal operation ───────────────────────────────────────────────

  it('returns none when difference is well within threshold', () => {
    expect(determineMileageWarningType(50100, 50000, 500)).toBe('none');
  });

  it('returns none when mileage is exactly the same', () => {
    expect(determineMileageWarningType(50000, 50000, 500)).toBe('none');
  });

  it('returns none when both mileages are zero', () => {
    expect(determineMileageWarningType(0, 0, 500)).toBe('none');
  });

  // ── none / unusually_high boundary (off-by-one) ──────────────────────────

  it('returns none when difference equals threshold exactly (> uses strict greater-than)', () => {
    // difference = 500, threshold = 500 → 500 > 500 is false → none
    expect(determineMileageWarningType(50500, 50000, 500)).toBe('none');
  });

  it('returns unusually_high when difference is exactly threshold + 1', () => {
    // difference = 501, threshold = 500 → 501 > 500 → unusually_high
    expect(determineMileageWarningType(50501, 50000, 500)).toBe('unusually_high');
  });

  // ── unusually_high ───────────────────────────────────────────────────────

  it('returns unusually_high when increase is far above threshold', () => {
    expect(determineMileageWarningType(1_000_000, 50_000, 500)).toBe('unusually_high');
  });

  it('returns unusually_high when threshold is 0 and there is any increase', () => {
    // threshold = 0 → difference = 1 > 0 → unusually_high
    expect(determineMileageWarningType(50001, 50000, 0)).toBe('unusually_high');
  });

  it('returns none when threshold is 0 and mileage is exactly equal (0 is not > 0)', () => {
    expect(determineMileageWarningType(50000, 50000, 0)).toBe('none');
  });

  // ── lower_than_previous ──────────────────────────────────────────────────

  it('returns lower_than_previous when newMileage is lower by a large amount', () => {
    expect(determineMileageWarningType(45000, 50000, 500)).toBe('lower_than_previous');
  });

  it('returns lower_than_previous when lower by exactly 1', () => {
    // Boundary: 49999 < 50000 → lower_than_previous regardless of threshold
    expect(determineMileageWarningType(49999, 50000, 500)).toBe('lower_than_previous');
  });

  it('returns lower_than_previous when newMileage is 0 and previous is non-zero', () => {
    expect(determineMileageWarningType(0, 50000, 500)).toBe('lower_than_previous');
  });

  it('returns lower_than_previous when newMileage is lower, even with a very small threshold', () => {
    // threshold = 0 but lower check runs first → lower_than_previous, not unusually_high
    expect(determineMileageWarningType(49999, 50000, 0)).toBe('lower_than_previous');
  });

  it('returns lower_than_previous for an extreme decrease', () => {
    expect(determineMileageWarningType(100, 999_999, 500)).toBe('lower_than_previous');
  });
});

// ─── validateMileage (async, mocked settings) ────────────────────────────────

describe('validateMileage — async with settings', () => {
  const BRANCH_ID = 7;
  const THRESHOLD = 500;

  beforeEach(() => {
    mockGetTypedSettings.mockResolvedValue({
      unusually_high_mileage_threshold: THRESHOLD,
    });
  });

  // ── Return shape: no warning ─────────────────────────────────────────────

  it('returns hasWarning:false when difference is within threshold', async () => {
    const result = await validateMileage(50100, 50000, BRANCH_ID);
    expect(result.hasWarning).toBe(false);
    expect(result.warningType).toBe('none');
    expect(result.warningMessage).toBeUndefined();
  });

  it('difference is computed correctly for a normal increase', async () => {
    const result = await validateMileage(52000, 50000, BRANCH_ID);
    expect(result.difference).toBe(2000);
  });

  it('previousMileage is echoed back unchanged', async () => {
    const result = await validateMileage(52000, 12345, BRANCH_ID);
    expect(result.previousMileage).toBe(12345);
  });

  it('difference is zero when both mileages are equal', async () => {
    const result = await validateMileage(50000, 50000, BRANCH_ID);
    expect(result.hasWarning).toBe(false);
    expect(result.difference).toBe(0);
  });

  // ── lower_than_previous ──────────────────────────────────────────────────

  it('sets hasWarning:true and warningType lower_than_previous when mileage decreases', async () => {
    const result = await validateMileage(49000, 50000, BRANCH_ID);
    expect(result.hasWarning).toBe(true);
    expect(result.warningType).toBe('lower_than_previous');
  });

  it('difference is negative when newMileage is lower than previous', async () => {
    const result = await validateMileage(49000, 50000, BRANCH_ID);
    expect(result.difference).toBe(-1000);
  });

  it('warningMessage for lower_than_previous is a non-empty Spanish string', async () => {
    const result = await validateMileage(49000, 50000, BRANCH_ID);
    expect(result.warningMessage).toBeDefined();
    expect(result.warningMessage).toContain('menor');
    expect(result.warningMessage).toContain('km');
  });

  it('lower_than_previous uses Math.abs for the displayed difference (always positive in message)', async () => {
    const result = await validateMileage(49000, 50000, BRANCH_ID);
    // message shows absolute difference, not the raw negative difference value
    expect(result.warningMessage).not.toContain('-');
  });

  // ── unusually_high ───────────────────────────────────────────────────────

  it('sets hasWarning:true and warningType unusually_high when increase exceeds threshold', async () => {
    const result = await validateMileage(50600, 50000, BRANCH_ID);
    expect(result.hasWarning).toBe(true);
    expect(result.warningType).toBe('unusually_high');
  });

  it('warningMessage for unusually_high is a non-empty Spanish string', async () => {
    const result = await validateMileage(50600, 50000, BRANCH_ID);
    expect(result.warningMessage).toBeDefined();
    expect(result.warningMessage).toContain('supera');
    expect(result.warningMessage).toContain('km');
  });

  it('warningMessage for unusually_high contains the actual difference and threshold', async () => {
    // difference = 600, threshold = 500 — both fit in a single word (no locale separator)
    const result = await validateMileage(50600, 50000, BRANCH_ID);
    expect(result.warningMessage).toContain('600');
    expect(result.warningMessage).toContain('500');
  });

  // ── Threshold boundary ───────────────────────────────────────────────────

  it('returns none when difference equals threshold exactly (strict greater-than)', async () => {
    // difference = 500, threshold = 500 → 500 > 500 is false → no warning
    const result = await validateMileage(50500, 50000, BRANCH_ID);
    expect(result.hasWarning).toBe(false);
    expect(result.warningType).toBe('none');
  });

  // ── Settings integration ─────────────────────────────────────────────────

  it('calls getTypedSettings with the correct branchId', async () => {
    await validateMileage(50100, 50000, BRANCH_ID);
    expect(mockGetTypedSettings).toHaveBeenCalledWith(BRANCH_ID);
  });

  it('a higher threshold from settings allows a larger difference to pass without warning', async () => {
    mockGetTypedSettings.mockResolvedValueOnce({ unusually_high_mileage_threshold: 1000 });
    // difference = 600, threshold now 1000 → 600 > 1000 is false → none
    const result = await validateMileage(50600, 50000, BRANCH_ID);
    expect(result.hasWarning).toBe(false);
    expect(result.warningType).toBe('none');
  });

  it('threshold=0 from settings triggers unusually_high on any positive increase', async () => {
    mockGetTypedSettings.mockResolvedValueOnce({ unusually_high_mileage_threshold: 0 });
    const result = await validateMileage(50001, 50000, BRANCH_ID);
    expect(result.hasWarning).toBe(true);
    expect(result.warningType).toBe('unusually_high');
  });

  it('a very large threshold from settings never triggers unusually_high in practice', async () => {
    mockGetTypedSettings.mockResolvedValueOnce({ unusually_high_mileage_threshold: 999_999 });
    const result = await validateMileage(100_000, 50_000, BRANCH_ID);
    expect(result.hasWarning).toBe(false);
    expect(result.warningType).toBe('none');
  });

  // ── DB failure propagates ────────────────────────────────────────────────

  it('rejects when getTypedSettings throws (DB failure propagates to caller)', async () => {
    mockGetTypedSettings.mockRejectedValueOnce(new Error('DB connection lost'));
    await expect(validateMileage(50100, 50000, BRANCH_ID)).rejects.toThrow('DB connection lost');
  });
});
