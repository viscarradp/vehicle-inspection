/**
 * Integration tests — Open Issue controller & routes.
 *
 *   GET  /open-issues              → listOpenIssues
 *   GET  /open-issues/:id          → getOpenIssue
 *   PUT  /open-issues/:id/status   → updateIssueStatus
 *   POST /open-issues/:id/close    → closeIssue
 *
 * Authorization:
 *   - All routes require requireAuth.
 *   - After auth, requireRole('jefe_operaciones','admin','admin_pais','admin_global')
 *     is applied at the ROUTER level (routes/openIssues.ts line 11).
 *   - guardia CANNOT access any open-issue endpoint (403 FORBIDDEN).
 *   - jefe_operaciones IS allowed on all routes.
 *
 * Mocking strategy:
 *   - dbContext / rate-limit → passthrough
 *   - ../db/issues           → getIssues, getIssueById, updateIssue, getOpenIssuesByVehicle
 *   - ../db/vehicles         → setOpenIssuesFlag
 *   - ../db/audit            → createAuditLog
 */

import request from 'supertest';

// ── Mocks ─────────────────────────────────────────────────────────────────────

jest.mock('../middleware/dbContext', () => ({
  dbContextMiddleware: (_req: any, _res: any, next: any) => next(),
}));

jest.mock('express-rate-limit', () => ({
  __esModule: true,
  default: () => (_req: any, _res: any, next: any) => next(),
}));

jest.mock('../db/issues');
jest.mock('../db/vehicles');
jest.mock('../db/audit');

// ─────────────────────────────────────────────────────────────────────────────

import { createApp } from '../config/app';
import {
  getIssues, getIssueById, updateIssue, getOpenIssuesByVehicle,
} from '../db/issues';
import { setOpenIssuesFlag } from '../db/vehicles';
import { createAuditLog } from '../db/audit';
import { authCookie, supervisorCookie, issueRow } from './helpers';

const mockGetIssues             = getIssues             as jest.MockedFunction<typeof getIssues>;
const mockGetIssueById          = getIssueById          as jest.MockedFunction<typeof getIssueById>;
const mockUpdateIssue           = updateIssue           as jest.MockedFunction<typeof updateIssue>;
const mockGetOpenIssuesByVehicle = getOpenIssuesByVehicle as jest.MockedFunction<typeof getOpenIssuesByVehicle>;
const mockSetOpenIssuesFlag     = setOpenIssuesFlag      as jest.MockedFunction<typeof setOpenIssuesFlag>;
const mockCreateAuditLog        = createAuditLog         as jest.MockedFunction<typeof createAuditLog>;

const app = createApp();

beforeAll(() => {
  jest.spyOn(console, 'error').mockImplementation(() => {});
});
afterAll(() => {
  (console.error as jest.Mock).mockRestore?.();
});

beforeEach(() => {
  mockGetIssues.mockResolvedValue([issueRow()]);
  mockGetIssueById.mockResolvedValue(issueRow());
  mockUpdateIssue.mockResolvedValue(undefined);
  mockGetOpenIssuesByVehicle.mockResolvedValue([]);
  mockSetOpenIssuesFlag.mockResolvedValue(undefined);
  mockCreateAuditLog.mockResolvedValue(undefined);
});

// ═════════════════════════════════════════════════════════════════════════════
describe('GET /open-issues', () => {
  describe('authentication & authorization', () => {
    it('no token → 401', async () => {
      const res = await request(app).get('/open-issues');
      expect(res.status).toBe(401);
    });

    it('guardia role → 403 FORBIDDEN (router-level guard)', async () => {
      const res = await request(app)
        .get('/open-issues')
        .set('Cookie', authCookie({ role: 'guardia' }));
      expect(res.status).toBe(403);
      expect(res.body.statusCode).toBe('FORBIDDEN');
    });

    it.each(['jefe_operaciones', 'admin', 'admin_pais', 'admin_global'] as const)(
      '%s role is allowed (router guard passes)',
      async (role) => {
        const res = await request(app)
          .get('/open-issues')
          .set('Cookie', authCookie({ role, branchId: 1, countryId: 1 }));
        expect(res.status).toBe(200);
      },
    );
  });

  describe('happy path', () => {
    it('no filters → 200 with full issue list', async () => {
      const res = await request(app)
        .get('/open-issues')
        .set('Cookie', supervisorCookie());
      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.data).toHaveLength(1);
      expect(res.body.data[0]).toMatchObject({ id: '200', status: 'open' });
    });

    it('empty result → 200 with empty array (not 404)', async () => {
      mockGetIssues.mockResolvedValue([]);
      const res = await request(app)
        .get('/open-issues')
        .set('Cookie', supervisorCookie());
      expect(res.status).toBe(200);
      expect(res.body.data).toEqual([]);
    });

    it('?status=open filter is forwarded to getIssues', async () => {
      const res = await request(app)
        .get('/open-issues?status=open')
        .set('Cookie', supervisorCookie());
      expect(res.status).toBe(200);
      expect(mockGetIssues).toHaveBeenCalledWith(
        expect.objectContaining({ status: 'open' }),
        expect.anything(),
      );
    });

    it('?vehicleId=10 filter is forwarded', async () => {
      await request(app)
        .get('/open-issues?vehicleId=10')
        .set('Cookie', supervisorCookie());
      expect(mockGetIssues).toHaveBeenCalledWith(
        expect.objectContaining({ vehicleId: '10' }),
        expect.anything(),
      );
    });

    it('?plate=ABC-123 filter is forwarded', async () => {
      await request(app)
        .get('/open-issues?plate=ABC-123')
        .set('Cookie', supervisorCookie());
      expect(mockGetIssues).toHaveBeenCalledWith(
        expect.objectContaining({ plate: 'ABC-123' }),
        expect.anything(),
      );
    });

    it('multiple filters combined are all forwarded', async () => {
      await request(app)
        .get('/open-issues?status=in_process&vehicleId=10')
        .set('Cookie', supervisorCookie());
      expect(mockGetIssues).toHaveBeenCalledWith(
        expect.objectContaining({ status: 'in_process', vehicleId: '10' }),
        expect.anything(),
      );
    });
  });

  describe('database failure → 500', () => {
    it('getIssues throws → 500 without crashing', async () => {
      mockGetIssues.mockRejectedValue(new Error('db down'));
      const res = await request(app)
        .get('/open-issues')
        .set('Cookie', supervisorCookie());
      expect(res.status).toBe(500);
      expect(res.body.statusCode).toBe('INTERNAL_ERROR');
    });
  });
});

// ═════════════════════════════════════════════════════════════════════════════
describe('GET /open-issues/:id', () => {
  it('no token → 401', async () => {
    const res = await request(app).get('/open-issues/200');
    expect(res.status).toBe(401);
  });

  it('guardia → 403', async () => {
    const res = await request(app)
      .get('/open-issues/200')
      .set('Cookie', authCookie({ role: 'guardia' }));
    expect(res.status).toBe(403);
  });

  it('issue not found → 404', async () => {
    mockGetIssueById.mockResolvedValue(null);
    const res = await request(app)
      .get('/open-issues/999')
      .set('Cookie', supervisorCookie());
    expect(res.status).toBe(404);
    expect(res.body.statusCode).toBe('NOT_FOUND');
  });

  it('issue found → 200 with full issue data', async () => {
    const res = await request(app)
      .get('/open-issues/200')
      .set('Cookie', supervisorCookie());
    expect(res.status).toBe(200);
    expect(res.body.data).toMatchObject({ id: '200', issueType: 'damage', status: 'open' });
  });

  it('scope is passed to getIssueById (cross-tenant cannot see issue)', async () => {
    // The scope is derived from the user's JWT — an admin_pais on a different
    // country would get null from getIssueById → 404.
    mockGetIssueById.mockResolvedValue(null);
    const res = await request(app)
      .get('/open-issues/200')
      .set('Cookie', authCookie({ role: 'admin_pais', countryId: 99 }));
    expect(res.status).toBe(404); // cannot see cross-country issue
  });

  it('DB failure → 500', async () => {
    mockGetIssueById.mockRejectedValue(new Error('timeout'));
    const res = await request(app)
      .get('/open-issues/200')
      .set('Cookie', supervisorCookie());
    expect(res.status).toBe(500);
  });
});

// ═════════════════════════════════════════════════════════════════════════════
describe('PUT /open-issues/:id/status', () => {
  describe('authentication & authorization', () => {
    it('no token → 401', async () => {
      const res = await request(app)
        .put('/open-issues/200/status')
        .send({ status: 'in_process' });
      expect(res.status).toBe(401);
    });

    it('guardia → 403', async () => {
      const res = await request(app)
        .put('/open-issues/200/status')
        .set('Cookie', authCookie({ role: 'guardia' }))
        .send({ status: 'in_process' });
      expect(res.status).toBe(403);
    });
  });

  describe('validation', () => {
    it('missing status field → 400 INVALID_STATUS', async () => {
      const res = await request(app)
        .put('/open-issues/200/status')
        .set('Cookie', supervisorCookie())
        .send({});
      expect(res.status).toBe(400);
      expect(res.body.statusCode).toBe('INVALID_STATUS');
    });

    it('status = null → 400 INVALID_STATUS', async () => {
      const res = await request(app)
        .put('/open-issues/200/status')
        .set('Cookie', supervisorCookie())
        .send({ status: null });
      expect(res.status).toBe(400);
      expect(res.body.statusCode).toBe('INVALID_STATUS');
    });

    it.each(['pending', 'closed', 'cancelled', ''])(
      'unrecognized status "%s" → 400 INVALID_STATUS',
      async (badStatus) => {
        const res = await request(app)
          .put('/open-issues/200/status')
          .set('Cookie', supervisorCookie())
          .send({ status: badStatus });
        expect(res.status).toBe(400);
        expect(res.body.statusCode).toBe('INVALID_STATUS');
      },
    );
  });

  describe('not found', () => {
    it('issue does not exist → 404', async () => {
      mockGetIssueById.mockResolvedValue(null);
      const res = await request(app)
        .put('/open-issues/999/status')
        .set('Cookie', supervisorCookie())
        .send({ status: 'in_process' });
      expect(res.status).toBe(404);
    });
  });

  describe('happy path — all valid statuses', () => {
    it.each(['open', 'in_process', 'resolved', 'dismissed'])(
      'status="%s" → 200 ISSUE_UPDATED',
      async (status) => {
        const res = await request(app)
          .put('/open-issues/200/status')
          .set('Cookie', supervisorCookie())
          .send({ status });
        expect(res.status).toBe(200);
        expect(res.body.statusCode).toBe('ISSUE_UPDATED');
        expect(mockUpdateIssue).toHaveBeenCalledWith('200', expect.objectContaining({ status }));
      },
    );

    it('maintenanceAction is forwarded to updateIssue', async () => {
      await request(app)
        .put('/open-issues/200/status')
        .set('Cookie', supervisorCookie())
        .send({ status: 'in_process', maintenanceAction: 'Enviado a taller' });
      expect(mockUpdateIssue).toHaveBeenCalledWith(
        '200',
        expect.objectContaining({ maintenanceAction: 'Enviado a taller' }),
      );
    });

    it('no maintenanceAction → updateIssue called with empty string fallback', async () => {
      await request(app)
        .put('/open-issues/200/status')
        .set('Cookie', supervisorCookie())
        .send({ status: 'open' });
      expect(mockUpdateIssue).toHaveBeenCalledWith(
        '200',
        expect.objectContaining({ maintenanceAction: '' }),
      );
    });
  });

  describe('database failure → 500', () => {
    it('updateIssue throws → 500', async () => {
      mockUpdateIssue.mockRejectedValue(new Error('lock timeout'));
      const res = await request(app)
        .put('/open-issues/200/status')
        .set('Cookie', supervisorCookie())
        .send({ status: 'in_process' });
      expect(res.status).toBe(500);
    });

    it('getIssueById throws → 500', async () => {
      mockGetIssueById.mockRejectedValue(new Error('connection reset'));
      const res = await request(app)
        .put('/open-issues/200/status')
        .set('Cookie', supervisorCookie())
        .send({ status: 'in_process' });
      expect(res.status).toBe(500);
    });
  });
});

// ═════════════════════════════════════════════════════════════════════════════
describe('POST /open-issues/:id/close', () => {
  describe('authentication & authorization', () => {
    it('no token → 401', async () => {
      const res = await request(app)
        .post('/open-issues/200/close')
        .send({ maintenanceAction: 'Reparado' });
      expect(res.status).toBe(401);
    });

    it('guardia → 403', async () => {
      const res = await request(app)
        .post('/open-issues/200/close')
        .set('Cookie', authCookie({ role: 'guardia' }))
        .send({ maintenanceAction: 'Reparado' });
      expect(res.status).toBe(403);
    });
  });

  describe('validation', () => {
    it('missing maintenanceAction → 400 ACTION_REQUIRED', async () => {
      const res = await request(app)
        .post('/open-issues/200/close')
        .set('Cookie', supervisorCookie())
        .send({});
      expect(res.status).toBe(400);
      expect(res.body.statusCode).toBe('ACTION_REQUIRED');
    });

    it('null maintenanceAction → 400 ACTION_REQUIRED', async () => {
      const res = await request(app)
        .post('/open-issues/200/close')
        .set('Cookie', supervisorCookie())
        .send({ maintenanceAction: null });
      expect(res.status).toBe(400);
      expect(res.body.statusCode).toBe('ACTION_REQUIRED');
    });

    it('whitespace-only maintenanceAction → 400 ACTION_REQUIRED', async () => {
      const res = await request(app)
        .post('/open-issues/200/close')
        .set('Cookie', supervisorCookie())
        .send({ maintenanceAction: '   ' });
      expect(res.status).toBe(400);
      expect(res.body.statusCode).toBe('ACTION_REQUIRED');
    });

    it('empty string maintenanceAction → 400 ACTION_REQUIRED', async () => {
      const res = await request(app)
        .post('/open-issues/200/close')
        .set('Cookie', supervisorCookie())
        .send({ maintenanceAction: '' });
      expect(res.status).toBe(400);
      expect(res.body.statusCode).toBe('ACTION_REQUIRED');
    });
  });

  describe('not found', () => {
    it('issue does not exist → 404', async () => {
      mockGetIssueById.mockResolvedValue(null);
      const res = await request(app)
        .post('/open-issues/999/close')
        .set('Cookie', supervisorCookie())
        .send({ maintenanceAction: 'Reparado' });
      expect(res.status).toBe(404);
      expect(res.body.statusCode).toBe('NOT_FOUND');
    });
  });

  describe('happy path', () => {
    const closeBody = { maintenanceAction: 'Reparado en taller', closingObservation: 'Sin costo' };

    it('valid close → 200 ISSUE_CLOSED', async () => {
      const res = await request(app)
        .post('/open-issues/200/close')
        .set('Cookie', supervisorCookie())
        .send(closeBody);
      expect(res.status).toBe(200);
      expect(res.body.statusCode).toBe('ISSUE_CLOSED');
    });

    it('updateIssue is called with closed status and closedAt/closedBy', async () => {
      await request(app)
        .post('/open-issues/200/close')
        .set('Cookie', supervisorCookie())
        .send(closeBody);
      expect(mockUpdateIssue).toHaveBeenCalledWith(
        '200',
        expect.objectContaining({
          status:             'resolved',
          maintenanceAction:  'Reparado en taller',
          closingObservation: 'Sin costo',
          closedBy:           '2',        // supervisorCookie userId
          closedAt:           expect.any(String),
        }),
      );
    });

    it('audit log is created with CLOSE_ISSUE action', async () => {
      await request(app)
        .post('/open-issues/200/close')
        .set('Cookie', supervisorCookie())
        .send(closeBody);
      expect(mockCreateAuditLog).toHaveBeenCalledWith(
        expect.objectContaining({
          action:   'CLOSE_ISSUE',
          entity:   'OpenIssue',
          entityId: '200',
        }),
      );
    });

    it('last open issue closed → setOpenIssuesFlag called with false', async () => {
      mockGetOpenIssuesByVehicle.mockResolvedValue([]); // no remaining open issues
      await request(app)
        .post('/open-issues/200/close')
        .set('Cookie', supervisorCookie())
        .send(closeBody);
      expect(mockSetOpenIssuesFlag).toHaveBeenCalledWith('10', false);
    });

    it('other issues still open → setOpenIssuesFlag called with true', async () => {
      mockGetOpenIssuesByVehicle.mockResolvedValue([
        issueRow({ id: '201', status: 'open' }),
      ]);
      await request(app)
        .post('/open-issues/200/close')
        .set('Cookie', supervisorCookie())
        .send(closeBody);
      expect(mockSetOpenIssuesFlag).toHaveBeenCalledWith('10', true);
    });

    it('custom status in body (e.g. dismissed) is passed through', async () => {
      await request(app)
        .post('/open-issues/200/close')
        .set('Cookie', supervisorCookie())
        .send({ ...closeBody, status: 'dismissed' });
      expect(mockUpdateIssue).toHaveBeenCalledWith(
        '200',
        expect.objectContaining({ status: 'dismissed' }),
      );
    });

    it('omitting closingObservation → stored as empty string', async () => {
      await request(app)
        .post('/open-issues/200/close')
        .set('Cookie', supervisorCookie())
        .send({ maintenanceAction: 'Reparado' });
      expect(mockUpdateIssue).toHaveBeenCalledWith(
        '200',
        expect.objectContaining({ closingObservation: '' }),
      );
    });
  });

  describe('database failure → 500', () => {
    it('getIssueById throws → 500', async () => {
      mockGetIssueById.mockRejectedValue(new Error('db unreachable'));
      const res = await request(app)
        .post('/open-issues/200/close')
        .set('Cookie', supervisorCookie())
        .send({ maintenanceAction: 'fix' });
      expect(res.status).toBe(500);
    });

    it('updateIssue throws → 500', async () => {
      mockUpdateIssue.mockRejectedValue(new Error('timeout'));
      const res = await request(app)
        .post('/open-issues/200/close')
        .set('Cookie', supervisorCookie())
        .send({ maintenanceAction: 'fix' });
      expect(res.status).toBe(500);
    });

    it('createAuditLog throws → 500', async () => {
      mockCreateAuditLog.mockRejectedValue(new Error('audit overflow'));
      const res = await request(app)
        .post('/open-issues/200/close')
        .set('Cookie', supervisorCookie())
        .send({ maintenanceAction: 'fix' });
      expect(res.status).toBe(500);
    });

    it('setOpenIssuesFlag throws → 500', async () => {
      mockSetOpenIssuesFlag.mockRejectedValue(new Error('connection lost'));
      const res = await request(app)
        .post('/open-issues/200/close')
        .set('Cookie', supervisorCookie())
        .send({ maintenanceAction: 'fix' });
      expect(res.status).toBe(500);
    });

    it('DB outage does not crash the server process', async () => {
      mockUpdateIssue.mockRejectedValue(new Error('boom'));
      await request(app)
        .post('/open-issues/200/close')
        .set('Cookie', supervisorCookie())
        .send({ maintenanceAction: 'fix' });
      const health = await request(app).get('/health');
      expect(health.status).toBe(200);
    });
  });
});
