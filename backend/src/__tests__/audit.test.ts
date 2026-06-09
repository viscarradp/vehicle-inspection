// Integration tests — routes/audit.ts
//
// Security surface tested:
//   • requireAuth gate
//   • requireRole('jefe_operaciones', ...) gate — guardia → 403
//   • requireValidBranchContext passthrough
//   • GET / filters entity/entityId query params
//   • Scope from scopeFromRequest
//   • DB failures → 500

import request from 'supertest';
import { createApp } from '../config/app';
import { authCookie, supervisorCookie, auditLogRow } from './helpers';

// ─── Mocks ───────────────────────────────────────────────────────────────────

jest.mock('../middleware/dbContext', () => ({
  dbContextMiddleware: (_req: any, _res: any, next: any) => next(),
}));
jest.mock('express-rate-limit', () => () => (_req: any, _res: any, next: any) => next());
jest.mock('../middleware/requireValidBranchContext', () => ({
  requireValidBranchContext: (_req: any, _res: any, next: any) => next(),
}));

jest.mock('../db/audit', () => ({
  createAuditLog: jest.fn().mockResolvedValue(undefined),
  getAuditLogs:   jest.fn(),
}));

// ─── Imports after mocks ──────────────────────────────────────────────────────

import { getAuditLogs } from '../db/audit';

const mockGetLogs = getAuditLogs as jest.Mock;

const app = createApp();

// ─── GET /audit-logs ──────────────────────────────────────────────────────────

describe('GET /audit-logs', () => {
  it('401 unauthenticated', async () => {
    const res = await request(app).get('/audit-logs');
    expect(res.status).toBe(401);
  });

  it('403 guardia cannot access audit logs', async () => {
    // No mock needed — requireRole blocks before getAuditLogs is called
    const res = await request(app).get('/audit-logs')
      .set('Cookie', authCookie({ role: 'guardia' }));
    expect(res.status).toBe(403);
  });

  it('200 jefe_operaciones can access audit logs', async () => {
    mockGetLogs.mockResolvedValueOnce([auditLogRow()]);
    const res = await request(app).get('/audit-logs')
      .set('Cookie', supervisorCookie());
    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.data).toHaveLength(1);
  });

  it('200 admin can access audit logs', async () => {
    mockGetLogs.mockResolvedValueOnce([auditLogRow(), auditLogRow({ id: '301' })]);
    const res = await request(app).get('/audit-logs')
      .set('Cookie', authCookie({ role: 'admin', branchId: 1 }));
    expect(res.status).toBe(200);
    expect(res.body.data).toHaveLength(2);
  });

  it('200 admin_pais can access audit logs', async () => {
    mockGetLogs.mockResolvedValueOnce([]);
    const cookie = authCookie({ role: 'admin_pais', countryId: 1 });
    const res = await request(app).get('/audit-logs').set('Cookie', cookie);
    expect(res.status).toBe(200);
  });

  it('200 admin_global can access audit logs', async () => {
    mockGetLogs.mockResolvedValueOnce([auditLogRow()]);
    const cookie = authCookie({ role: 'admin_global', branchId: undefined });
    const res = await request(app).get('/audit-logs').set('Cookie', cookie);
    expect(res.status).toBe(200);
  });

  it('200 empty logs list', async () => {
    mockGetLogs.mockResolvedValueOnce([]);
    const res = await request(app).get('/audit-logs').set('Cookie', supervisorCookie());
    expect(res.status).toBe(200);
    expect(res.body.data).toHaveLength(0);
  });

  it('passes entity filter to getAuditLogs', async () => {
    mockGetLogs.mockResolvedValueOnce([]);
    await request(app).get('/audit-logs?entity=Setting')
      .set('Cookie', supervisorCookie());
    expect(mockGetLogs).toHaveBeenCalledWith(
      expect.objectContaining({ entity: 'Setting', entityId: undefined }),
      expect.any(Object),
    );
  });

  it('passes entity + entityId filters together', async () => {
    mockGetLogs.mockResolvedValueOnce([auditLogRow()]);
    await request(app).get('/audit-logs?entity=Setting&entityId=no_review_days_threshold')
      .set('Cookie', supervisorCookie());
    expect(mockGetLogs).toHaveBeenCalledWith(
      expect.objectContaining({
        entity:   'Setting',
        entityId: 'no_review_days_threshold',
      }),
      expect.any(Object),
    );
  });

  it('passes scope from scopeFromRequest', async () => {
    mockGetLogs.mockResolvedValueOnce([]);
    const cookie = supervisorCookie({ branchId: 5 });
    await request(app).get('/audit-logs').set('Cookie', cookie);
    expect(mockGetLogs).toHaveBeenCalledWith(
      expect.any(Object),
      expect.objectContaining({ kind: 'branch', branchId: 5 }),
    );
  });

  it('500 on DB failure', async () => {
    mockGetLogs.mockRejectedValueOnce(new Error('DB timeout'));
    const res = await request(app).get('/audit-logs').set('Cookie', supervisorCookie());
    expect(res.status).toBe(500);
    expect(res.body.statusCode).toBe('INTERNAL_ERROR');
  });

  it('does not leak audit logs to guardia even with valid cookie', async () => {
    const cookie = authCookie({ role: 'guardia', branchId: 1 });
    const res = await request(app).get('/audit-logs').set('Cookie', cookie);
    expect(res.status).toBe(403);
    expect(mockGetLogs).not.toHaveBeenCalled();
  });
});
