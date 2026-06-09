// Integration tests — routes/settings.ts + controllers/settingsController.ts
//
// Security surface tested:
//   • requireAuth gate
//   • requireRole('admin', 'admin_pais', 'admin_global') on PUT/POST reset
//   • assertCanAccessScope — pure tenant containment (runs for real):
//       - write global → only admin_global
//       - write country:1 → only admin_pais with countryId=1
//       - write branch:1 → admin of that branch, or admin_pais whose country contains it
//   • Unknown setting key → 400 UNKNOWN_SETTING
//   • Empty body → 400 INVALID_BODY
//   • Array body → 400 INVALID_BODY
//   • null value → treated as reset (RESET_SETTING in audit)
//   • Audit log created for each key
//   • POST /settings/reset with explicit keys array
//   • POST /settings/reset without keys → resets all writable existing overrides
//   • DB failures → 500

import request from 'supertest';
import { createApp } from '../config/app';
import { authCookie, supervisorCookie } from './helpers';

// ─── Mocks ───────────────────────────────────────────────────────────────────

jest.mock('../middleware/dbContext', () => ({
  dbContextMiddleware: (_req: any, _res: any, next: any) => next(),
}));
jest.mock('express-rate-limit', () => () => (_req: any, _res: any, next: any) => next());

jest.mock('../db/settings', () => ({
  getSettingsWithMeta: jest.fn(),
  upsertSetting:       jest.fn().mockResolvedValue(undefined),
  getOverrideAtScope:  jest.fn(),
  runWithSettingsCache: (_next: any) => _next(),
}));
jest.mock('../db/audit', () => ({
  createAuditLog: jest.fn().mockResolvedValue(undefined),
  getAuditLogs:   jest.fn(),
}));
jest.mock('../db/scopeUtils', () => ({
  assertResourceInScope: jest.fn().mockResolvedValue(undefined),
  applyScopeWhere:       jest.fn(() => '1=1'),
}));

// ─── Imports after mocks ──────────────────────────────────────────────────────

import { getSettingsWithMeta, upsertSetting, getOverrideAtScope } from '../db/settings';
import { createAuditLog } from '../db/audit';
import { assertResourceInScope } from '../db/scopeUtils';
import { AppError } from '../middleware/errorHandler';

const mockGetMeta      = getSettingsWithMeta as jest.Mock;
const mockUpsert       = upsertSetting       as jest.Mock;
const mockGetOverride  = getOverrideAtScope  as jest.Mock;
const mockAudit        = createAuditLog      as jest.Mock;
const mockAssertScope  = assertResourceInScope as jest.Mock;

// Typical metadata response shape
const fakeSettingsMeta = [
  {
    key:          'no_review_days_threshold',
    value:        3,
    source:       'global',
    canEdit:      true,
    writableFrom: 'admin',
    description:  'Días sin revisión para alerta',
  },
];

const app = createApp();

// ─── GET /settings ────────────────────────────────────────────────────────────

describe('GET /settings', () => {
  it('401 unauthenticated', async () => {
    const res = await request(app).get('/settings');
    expect(res.status).toBe(401);
  });

  it('200 guardia can read own branch settings (no explicit level)', async () => {
    mockGetMeta.mockResolvedValueOnce(fakeSettingsMeta);
    const cookie = authCookie({ role: 'guardia', branchId: 1 });
    const res = await request(app).get('/settings').set('Cookie', cookie);
    expect(res.status).toBe(200);
    expect(res.body.data).toHaveLength(1);
  });

  it('200 guardia can read global level (read-only, no DB needed for assertCanAccessScope)', async () => {
    mockGetMeta.mockResolvedValueOnce(fakeSettingsMeta);
    const cookie = authCookie({ role: 'guardia', branchId: 1 });
    const res = await request(app).get('/settings?level=global').set('Cookie', cookie);
    expect(res.status).toBe(200);
  });

  it('403 guardia tries to read another branch settings', async () => {
    // guardia branchId=1 targeting branch:99 → OUTSIDE_SCOPE
    const cookie = authCookie({ role: 'guardia', branchId: 1 });
    const res = await request(app).get('/settings?level=branch&branchId=99').set('Cookie', cookie);
    expect(res.status).toBe(403);
    expect(res.body.statusCode).toBe('OUTSIDE_SCOPE');
  });

  it('400 malformed level', async () => {
    const cookie = authCookie({ role: 'admin', branchId: 1 });
    const res = await request(app).get('/settings?level=universe').set('Cookie', cookie);
    expect(res.status).toBe(400);
    expect(res.body.statusCode).toBe('INVALID_SCOPE');
  });

  it('400 country level without countryId param', async () => {
    const cookie = authCookie({ role: 'admin_pais', countryId: 1 });
    const res = await request(app).get('/settings?level=country').set('Cookie', cookie);
    expect(res.status).toBe(400);
    expect(res.body.statusCode).toBe('INVALID_SCOPE');
  });

  it('500 on DB failure', async () => {
    mockGetMeta.mockRejectedValueOnce(new Error('DB timeout'));
    const cookie = authCookie({ role: 'admin', branchId: 1 });
    const res = await request(app).get('/settings').set('Cookie', cookie);
    expect(res.status).toBe(500);
  });
});

// ─── PUT /settings ────────────────────────────────────────────────────────────

describe('PUT /settings', () => {
  const adminCookie = authCookie({ userId: '3', role: 'admin', branchId: 1, fullName: 'Admin Test' });

  beforeEach(() => {
    mockGetOverride.mockResolvedValue(new Map());
  });

  it('401 unauthenticated', async () => {
    const res = await request(app).put('/settings').send({ no_review_days_threshold: 5 });
    expect(res.status).toBe(401);
  });

  it('403 guardia cannot write settings', async () => {
    const res = await request(app).put('/settings')
      .set('Cookie', authCookie({ role: 'guardia' }))
      .send({ no_review_days_threshold: 5 });
    expect(res.status).toBe(403);
  });

  it('403 jefe_operaciones cannot write settings', async () => {
    const res = await request(app).put('/settings')
      .set('Cookie', supervisorCookie())
      .send({ no_review_days_threshold: 5 });
    expect(res.status).toBe(403);
  });

  it('400 empty body', async () => {
    const res = await request(app).put('/settings')
      .set('Cookie', adminCookie)
      .send({});
    expect(res.status).toBe(400);
    expect(res.body.statusCode).toBe('INVALID_BODY');
  });

  it('400 array body instead of object', async () => {
    const res = await request(app).put('/settings')
      .set('Cookie', adminCookie)
      .send([{ no_review_days_threshold: 5 }]);
    expect(res.status).toBe(400);
    expect(res.body.statusCode).toBe('INVALID_BODY');
  });

  it('400 unknown setting key', async () => {
    const res = await request(app).put('/settings')
      .set('Cookie', adminCookie)
      .send({ hacker_key: 'exploit' });
    expect(res.status).toBe(400);
    expect(res.body.statusCode).toBe('UNKNOWN_SETTING');
  });

  it('400 mix of valid and invalid keys — rejects all-or-nothing', async () => {
    const res = await request(app).put('/settings')
      .set('Cookie', adminCookie)
      .send({ no_review_days_threshold: 3, invalid_key: 'bad' });
    expect(res.status).toBe(400);
    expect(res.body.statusCode).toBe('UNKNOWN_SETTING');
    expect(mockUpsert).not.toHaveBeenCalled();
  });

  it('200 admin updates valid key for their branch', async () => {
    const res = await request(app).put('/settings')
      .set('Cookie', adminCookie)
      .send({ no_review_days_threshold: 5 });
    expect(res.status).toBe(200);
    expect(res.body.statusCode).toBe('SETTINGS_UPDATED');
    expect(mockUpsert).toHaveBeenCalledWith(
      'no_review_days_threshold', 5, expect.objectContaining({ kind: 'branch', branchId: 1 }), 'admin',
    );
    expect(mockAudit).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'UPDATE_SETTING', entityId: 'no_review_days_threshold' }),
    );
  });

  it('200 null value triggers RESET_SETTING audit action', async () => {
    const res = await request(app).put('/settings')
      .set('Cookie', adminCookie)
      .send({ no_review_days_threshold: null });
    expect(res.status).toBe(200);
    expect(mockAudit).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'RESET_SETTING' }),
    );
  });

  it('200 updates multiple keys at once; one audit log per key', async () => {
    const res = await request(app).put('/settings')
      .set('Cookie', adminCookie)
      .send({ no_review_days_threshold: 7, unseen_alert_hours: 4 });
    expect(res.status).toBe(200);
    expect(mockUpsert).toHaveBeenCalledTimes(2);
    expect(mockAudit).toHaveBeenCalledTimes(2);
  });

  it('403 admin tries to write global level settings', async () => {
    const res = await request(app).put('/settings?level=global')
      .set('Cookie', adminCookie)
      .send({ no_review_days_threshold: 3 });
    expect(res.status).toBe(403);
    expect(res.body.statusCode).toBe('OUTSIDE_SCOPE');
  });

  it('403 admin_pais tries to write settings for another country', async () => {
    const cookie = authCookie({ userId: '5', role: 'admin_pais', countryId: 1 });
    const res = await request(app).put('/settings?level=country&countryId=2')
      .set('Cookie', cookie)
      .send({ no_review_days_threshold: 3 });
    expect(res.status).toBe(403);
    expect(res.body.statusCode).toBe('OUTSIDE_SCOPE');
  });

  it('200 admin_pais updates settings for their own country', async () => {
    const cookie = authCookie({ userId: '5', role: 'admin_pais', countryId: 1, fullName: 'AP Test' });
    const res = await request(app).put('/settings?level=country&countryId=1')
      .set('Cookie', cookie)
      .send({ no_review_days_threshold: 4 });
    expect(res.status).toBe(200);
    expect(mockUpsert).toHaveBeenCalledWith(
      'no_review_days_threshold', 4,
      expect.objectContaining({ kind: 'country', countryId: 1 }),
      'admin_pais',
    );
  });

  it('200 admin_global updates global settings', async () => {
    const cookie = authCookie({ role: 'admin_global', branchId: undefined, fullName: 'AG Test' });
    const res = await request(app).put('/settings?level=global')
      .set('Cookie', cookie)
      .send({ no_review_days_threshold: 2 });
    expect(res.status).toBe(200);
    expect(mockUpsert).toHaveBeenCalledWith(
      'no_review_days_threshold', 2,
      expect.objectContaining({ kind: 'global' }),
      'admin_global',
    );
  });

  it('prior value from getOverrideAtScope is recorded in audit oldValue', async () => {
    mockGetOverride.mockResolvedValueOnce(new Map([['no_review_days_threshold', '3']]));
    await request(app).put('/settings')
      .set('Cookie', adminCookie)
      .send({ no_review_days_threshold: 5 });
    expect(mockAudit).toHaveBeenCalledWith(
      expect.objectContaining({
        oldValue: expect.objectContaining({ value: 3 }),
        newValue: expect.objectContaining({ value: 5 }),
      }),
    );
  });

  it('500 on upsertSetting DB failure', async () => {
    mockUpsert.mockRejectedValueOnce(new Error('DB write error'));
    const res = await request(app).put('/settings')
      .set('Cookie', adminCookie)
      .send({ no_review_days_threshold: 3 });
    expect(res.status).toBe(500);
  });
});

// ─── POST /settings/reset ────────────────────────────────────────────────────

describe('POST /settings/reset', () => {
  const adminCookie = authCookie({ userId: '3', role: 'admin', branchId: 1, fullName: 'Admin Test' });

  beforeEach(() => {
    mockGetOverride.mockResolvedValue(new Map([['no_review_days_threshold', '5']]));
  });

  it('401 unauthenticated', async () => {
    const res = await request(app).post('/settings/reset');
    expect(res.status).toBe(401);
  });

  it('403 jefe_operaciones cannot reset', async () => {
    const res = await request(app).post('/settings/reset')
      .set('Cookie', supervisorCookie())
      .send({});
    expect(res.status).toBe(403);
  });

  it('400 keys is not an array', async () => {
    const res = await request(app).post('/settings/reset')
      .set('Cookie', adminCookie)
      .send({ keys: 'no_review_days_threshold' }); // should be array
    expect(res.status).toBe(400);
    expect(res.body.statusCode).toBe('INVALID_BODY');
  });

  it('400 unknown key in keys array', async () => {
    const res = await request(app).post('/settings/reset')
      .set('Cookie', adminCookie)
      .send({ keys: ['no_review_days_threshold', 'hacker_field'] });
    expect(res.status).toBe(400);
    expect(res.body.statusCode).toBe('UNKNOWN_SETTING');
  });

  it('200 reset specific key — upsertSetting called with null', async () => {
    const res = await request(app).post('/settings/reset')
      .set('Cookie', adminCookie)
      .send({ keys: ['no_review_days_threshold'] });
    expect(res.status).toBe(200);
    expect(res.body.statusCode).toBe('SETTINGS_RESET');
    expect(mockUpsert).toHaveBeenCalledWith(
      'no_review_days_threshold', null, expect.any(Object), 'admin',
    );
  });

  it('200 reset-all omitting keys — resets all existing overrides the actor may write', async () => {
    const res = await request(app).post('/settings/reset')
      .set('Cookie', adminCookie)
      .send({});
    expect(res.status).toBe(200);
    expect(res.body.statusCode).toBe('SETTINGS_RESET');
  });

  it('200 reports count=0 when no overrides exist at scope', async () => {
    mockGetOverride.mockResolvedValueOnce(new Map()); // no existing overrides
    const res = await request(app).post('/settings/reset')
      .set('Cookie', adminCookie)
      .send({});
    expect(res.status).toBe(200);
    expect(res.body.message).toMatch(/0 override/);
  });

  it('500 on DB failure', async () => {
    mockUpsert.mockRejectedValueOnce(new Error('DB error'));
    const res = await request(app).post('/settings/reset')
      .set('Cookie', adminCookie)
      .send({ keys: ['no_review_days_threshold'] });
    expect(res.status).toBe(500);
  });
});
