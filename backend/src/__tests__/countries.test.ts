// Integration tests — routes/countries.ts
//
// Security surface tested:
//   • requireAuth gate
//   • requireGlobal: only admin_global may write; all other roles get 403
//   • Missing required fields → 400 MISSING_FIELDS
//   • GET → any authenticated role
//   • PUT, PATCH activate/deactivate → admin_global only
//   • 404 when getCountryById throws not found
//   • DB failures → 500

import request from 'supertest';
import { createApp } from '../config/app';
import { AppError } from '../middleware/errorHandler';
import { authCookie, supervisorCookie, countryRow } from './helpers';

// ─── Mocks ───────────────────────────────────────────────────────────────────

jest.mock('../middleware/dbContext', () => ({
  dbContextMiddleware: (_req: any, _res: any, next: any) => next(),
}));
jest.mock('express-rate-limit', () => () => (_req: any, _res: any, next: any) => next());

jest.mock('../db/countries', () => ({
  getCountries:     jest.fn(),
  getCountryById:   jest.fn(),
  createCountry:    jest.fn(),
  updateCountry:    jest.fn(),
  setCountryActive: jest.fn(),
}));

// ─── Imports after mocks ──────────────────────────────────────────────────────

import {
  getCountries, getCountryById, createCountry, updateCountry, setCountryActive,
} from '../db/countries';

const mockGetAll      = getCountries     as jest.Mock;
const mockGetById     = getCountryById   as jest.Mock;
const mockCreate      = createCountry    as jest.Mock;
const mockUpdate      = updateCountry    as jest.Mock;
const mockSetActive   = setCountryActive as jest.Mock;

const app = createApp();
const globalCookie = authCookie({ role: 'admin_global', branchId: undefined });

// ─── GET /countries ───────────────────────────────────────────────────────────

describe('GET /countries', () => {
  it('401 unauthenticated', async () => {
    const res = await request(app).get('/countries');
    expect(res.status).toBe(401);
  });

  it('200 guardia can list countries', async () => {
    mockGetAll.mockResolvedValueOnce([countryRow()]);
    const res = await request(app).get('/countries')
      .set('Cookie', authCookie({ role: 'guardia', branchId: 1 }));
    expect(res.status).toBe(200);
    expect(res.body.data).toHaveLength(1);
  });

  it('200 all roles can list countries', async () => {
    for (const role of ['guardia', 'jefe_operaciones', 'admin', 'admin_pais', 'admin_global'] as const) {
      mockGetAll.mockResolvedValueOnce([countryRow()]);
      const res = await request(app).get('/countries')
        .set('Cookie', authCookie({ role, branchId: 1, countryId: 1 }));
      expect(res.status).toBe(200);
    }
  });

  it('200 empty list', async () => {
    mockGetAll.mockResolvedValueOnce([]);
    const res = await request(app).get('/countries').set('Cookie', authCookie());
    expect(res.status).toBe(200);
    expect(res.body.data).toHaveLength(0);
  });

  it('500 on DB failure', async () => {
    mockGetAll.mockRejectedValueOnce(new Error('DB error'));
    const res = await request(app).get('/countries').set('Cookie', authCookie());
    expect(res.status).toBe(500);
  });
});

// ─── POST /countries ──────────────────────────────────────────────────────────

describe('POST /countries', () => {
  it('401 unauthenticated', async () => {
    const res = await request(app).post('/countries').send({ code: 'MX', name: 'México', timezone: 'America/Mexico_City' });
    expect(res.status).toBe(401);
  });

  it('403 for all non-global roles', async () => {
    for (const role of ['guardia', 'jefe_operaciones', 'admin', 'admin_pais'] as const) {
      const res = await request(app).post('/countries')
        .set('Cookie', authCookie({ role, branchId: 1, countryId: 1 }))
        .send({ code: 'MX', name: 'México', timezone: 'America/Mexico_City' });
      expect(res.status).toBe(403);
    }
  });

  it('400 missing code', async () => {
    const res = await request(app).post('/countries')
      .set('Cookie', globalCookie)
      .send({ name: 'México', timezone: 'America/Mexico_City' });
    expect(res.status).toBe(400);
    expect(res.body.statusCode).toBe('MISSING_FIELDS');
  });

  it('400 missing name', async () => {
    const res = await request(app).post('/countries')
      .set('Cookie', globalCookie)
      .send({ code: 'MX', timezone: 'America/Mexico_City' });
    expect(res.status).toBe(400);
    expect(res.body.statusCode).toBe('MISSING_FIELDS');
  });

  it('400 missing timezone', async () => {
    const res = await request(app).post('/countries')
      .set('Cookie', globalCookie)
      .send({ code: 'MX', name: 'México' });
    expect(res.status).toBe(400);
    expect(res.body.statusCode).toBe('MISSING_FIELDS');
  });

  it('400 all three fields missing at once', async () => {
    const res = await request(app).post('/countries')
      .set('Cookie', globalCookie)
      .send({});
    expect(res.status).toBe(400);
    expect(res.body.statusCode).toBe('MISSING_FIELDS');
  });

  it('201 admin_global creates country', async () => {
    mockCreate.mockResolvedValueOnce(countryRow({ id: 5, code: 'MX', name: 'México', timezone: 'America/Mexico_City' }));
    const res = await request(app).post('/countries')
      .set('Cookie', globalCookie)
      .send({ code: 'MX', name: 'México', timezone: 'America/Mexico_City' });
    expect(res.status).toBe(201);
    expect(res.body.statusCode).toBe('COUNTRY_CREATED');
    expect(res.body.data.code).toBe('MX');
  });

  it('500 on DB failure (e.g. duplicate code)', async () => {
    mockCreate.mockRejectedValueOnce(new Error('Unique constraint violation'));
    const res = await request(app).post('/countries')
      .set('Cookie', globalCookie)
      .send({ code: 'GT', name: 'Guatemala Duplicate', timezone: 'America/Guatemala' });
    expect(res.status).toBe(500);
  });
});

// ─── PUT /countries/:id ──────────────────────────────────────────────────────

describe('PUT /countries/:id', () => {
  it('403 for non-global roles', async () => {
    const res = await request(app).put('/countries/1')
      .set('Cookie', authCookie({ role: 'admin_pais', countryId: 1 }))
      .send({ name: 'Guatemala Editado' });
    expect(res.status).toBe(403);
  });

  it('200 admin_global updates country', async () => {
    mockGetById.mockResolvedValueOnce(countryRow());
    mockUpdate.mockResolvedValueOnce(undefined);
    const res = await request(app).put('/countries/1')
      .set('Cookie', globalCookie)
      .send({ name: 'Guatemala Actualizado', timezone: 'America/Guatemala' });
    expect(res.status).toBe(200);
    expect(res.body.statusCode).toBe('COUNTRY_UPDATED');
  });

  it('404 country not found', async () => {
    mockGetById.mockRejectedValueOnce(new AppError(404, 'NOT_FOUND', 'País no encontrado'));
    const res = await request(app).put('/countries/999')
      .set('Cookie', globalCookie)
      .send({ name: 'Ghost Country' });
    expect(res.status).toBe(404);
  });
});

// ─── PATCH /countries/:id/activate|deactivate ────────────────────────────────

describe('PATCH /countries/:id/activate|deactivate', () => {
  it('403 non-global on activate', async () => {
    const res = await request(app).patch('/countries/1/activate')
      .set('Cookie', authCookie({ role: 'admin_pais', countryId: 1 }));
    expect(res.status).toBe(403);
  });

  it('200 admin_global activates country', async () => {
    mockGetById.mockResolvedValueOnce(countryRow({ active: false }));
    mockSetActive.mockResolvedValueOnce(undefined);
    const res = await request(app).patch('/countries/1/activate')
      .set('Cookie', globalCookie);
    expect(res.status).toBe(200);
    expect(res.body.statusCode).toBe('COUNTRY_ACTIVATED');
    expect(mockSetActive).toHaveBeenCalledWith(1, true);
  });

  it('200 admin_global deactivates country', async () => {
    mockGetById.mockResolvedValueOnce(countryRow({ active: true }));
    mockSetActive.mockResolvedValueOnce(undefined);
    const res = await request(app).patch('/countries/1/deactivate')
      .set('Cookie', globalCookie);
    expect(res.status).toBe(200);
    expect(res.body.statusCode).toBe('COUNTRY_DEACTIVATED');
    expect(mockSetActive).toHaveBeenCalledWith(1, false);
  });

  it('404 country not found on toggle', async () => {
    mockGetById.mockRejectedValueOnce(new AppError(404, 'NOT_FOUND', 'País no encontrado'));
    const res = await request(app).patch('/countries/999/activate')
      .set('Cookie', globalCookie);
    expect(res.status).toBe(404);
  });

  it('500 on DB failure', async () => {
    mockGetById.mockResolvedValueOnce(countryRow());
    mockSetActive.mockRejectedValueOnce(new Error('DB error'));
    const res = await request(app).patch('/countries/1/deactivate')
      .set('Cookie', globalCookie);
    expect(res.status).toBe(500);
  });
});
