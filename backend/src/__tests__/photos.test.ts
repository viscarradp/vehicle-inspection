// Integration tests — photoController.ts (routes/photos.ts + routes/inspections.ts)
//
// Endpoints:
//   GET  /photos/file/*               → servePhoto
//   POST /inspections/:id/photos      → uploadPhoto  (multer multipart)
//   GET  /inspections/:id/photos      → getInspectionPhotos
//
// Security surface:
//   • requireAuth gate on all endpoints
//   • servePhoto: storage path used as lookup key in DB before serving
//     — prevents unauthenticated file access and cross-tenant leakage
//     — path traversal attempt returns 404 (path never touches disk directly)
//   • uploadPhoto: sealed inspection guard (current shift only for guardias)
//   • uploadPhoto: MIME validation (allowed list)
//   • uploadPhoto: magic-byte validation (MIME spoofing: PDF disguised as JPEG → 400)
//   • uploadPhoto: per-branch size limit (settings.max_photo_size_mb)
//   • uploadPhoto: vehicleId/plate taken from DB inspection, NOT from request body
//     — prevents cross-vehicle photo injection
//   • getInspectionPhotos: scope guard (404 for out-of-scope inspections)

import request from 'supertest';
import { createApp } from '../config/app';
import { AppError } from '../middleware/errorHandler';
import {
  authCookie, supervisorCookie, inspectionRow,
} from './helpers';
import type { Photo } from '../types';

// ─── Test buffers ─────────────────────────────────────────────────────────────
// Real magic bytes so validateMagicBytes (runs without mocking) passes/fails as expected.

// JPEG: FF D8 FF E0 00 10 JFIF\0
const JPEG_BUF = Buffer.from([
  0xFF, 0xD8, 0xFF, 0xE0, 0x00, 0x10, 0x4A, 0x46, 0x49, 0x46, 0x00, 0x01,
  ...Array(100).fill(0xAA),  // padding
]);
// PNG: 89 50 4E 47 0D 0A 1A 0A
const PNG_BUF = Buffer.from([
  0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A,
  ...Array(100).fill(0x00),
]);
// WebP: RIFF????WEBP
const WEBP_BUF = (() => {
  const b = Buffer.alloc(120);
  b.write('RIFF', 0, 'ascii');
  b.write('WEBP', 8, 'ascii');
  return b;
})();
// PDF disguised as JPEG (magic = %PDF)
const PDF_DISGUISED_AS_JPEG = Buffer.from('%PDF-1.4 fake'.split('').map(c => c.charCodeAt(0)));
// ZIP file (PK magic bytes)
const ZIP_BUF = Buffer.from([0x50, 0x4B, 0x03, 0x04, 0x14, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00]);
// Too-small buffer (< 12 bytes — fails magic check)
const TINY_BUF = Buffer.from([0xFF, 0xD8, 0xFF]);

// ─── Mocks ───────────────────────────────────────────────────────────────────

jest.mock('../middleware/dbContext', () => ({
  dbContextMiddleware: (_req: any, _res: any, next: any) => next(),
}));
jest.mock('express-rate-limit', () => () => (_req: any, _res: any, next: any) => next());

// bcryptjs.hashSync called at authController module init
jest.mock('bcryptjs', () => ({
  default: {
    hash:     jest.fn().mockResolvedValue('$2a$12$hashed'),
    hashSync: jest.fn().mockReturnValue('$2a$12$dummy'),
    compare:  jest.fn().mockResolvedValue(false),
  },
  hash:     jest.fn().mockResolvedValue('$2a$12$hashed'),
  hashSync: jest.fn().mockReturnValue('$2a$12$dummy'),
  compare:  jest.fn().mockResolvedValue(false),
}));

jest.mock('../db/photos', () => ({
  createPhotoRecord:     jest.fn(),
  getPhotosByInspection: jest.fn(),
  getPhotoByStoragePath: jest.fn(),
  getPhotosByOpenIssue:  jest.fn(),
}));

jest.mock('../db/inspections', () => ({
  getInspectionById:       jest.fn(),
  markHasPhotos:           jest.fn().mockResolvedValue(undefined),
  getInspectionsByDate:    jest.fn(),
  getInspectionsByVehicle: jest.fn(),
  getInspectionCounts:     jest.fn(),
  getUnseenVehicles:       jest.fn(),
  createInspection:        jest.fn(),
  updateInspection:        jest.fn(),
  findInspectionForShift:  jest.fn(),
  getDashboardCounts:      jest.fn(),
}));

jest.mock('../db/settings', () => ({
  getTypedSettings:     jest.fn(),
  runWithSettingsCache: (_next: any) => _next(),
}));

jest.mock('../db/branches', () => ({
  getBranchTimezone:  jest.fn().mockResolvedValue('America/Guatemala'),
  getBranches:        jest.fn(),
  getBranchById:      jest.fn(),
  createBranch:       jest.fn(),
  updateBranch:       jest.fn(),
  setBranchActive:    jest.fn(),
}));

jest.mock('../db/timezone', () => ({
  getDateInTimezone:   jest.fn(() => '2026-06-09'),
  getHourInTimezone:   jest.fn(() => 8),
  resolveShift:        jest.fn(() => 'morning'),
  getOperationalDate:  jest.fn(() => '2026-06-09'),
}));

// Partial mock — keep validatePhotoMime/validateMagicBytes/validateFileSize real
// so security logic runs without stubbing; only storePhoto needs to be faked.
jest.mock('../services/photoService', () => {
  const real = jest.requireActual('../services/photoService');
  return {
    ...real,
    storePhoto: jest.fn(),
  };
});

jest.mock('../services/storage', () => ({
  getPhotoStorage: jest.fn(() => ({
    put:   jest.fn().mockResolvedValue('http://internal/photos/test.jpg'),
    serve: jest.fn().mockImplementation((_p: string, res: any) => {
      res.setHeader('Content-Type', 'image/jpeg');
      res.send(JPEG_BUF);
    }),
  })),
}));

jest.mock('../db/scopeUtils', () => ({
  assertResourceInScope: jest.fn().mockResolvedValue(undefined),
  applyScopeWhere:       jest.fn(() => '1=1'),
}));

// ─── Imports after mocks ──────────────────────────────────────────────────────

import {
  createPhotoRecord, getPhotosByInspection, getPhotoByStoragePath,
} from '../db/photos';
import { getInspectionById, markHasPhotos } from '../db/inspections';
import { getTypedSettings } from '../db/settings';
import { storePhoto } from '../services/photoService';
import { getPhotoStorage } from '../services/storage';

const mockGetPhotoByPath   = getPhotoByStoragePath as jest.Mock;
const mockGetPhotosByInsp  = getPhotosByInspection as jest.Mock;
const mockCreatePhoto      = createPhotoRecord     as jest.Mock;
const mockGetInspection    = getInspectionById     as jest.Mock;
const mockMarkHasPhotos    = markHasPhotos         as jest.Mock;
const mockGetSettings      = getTypedSettings      as jest.Mock;
const mockStorePhoto       = storePhoto            as jest.Mock;
const mockGetStorage       = getPhotoStorage       as jest.Mock;

// ─── Photo factory ────────────────────────────────────────────────────────────

function photoRecord(overrides: Partial<Photo> = {}): Photo {
  return {
    id:          '500',
    inspectionId:'100',
    vehicleId:   '10',
    plate:       'ABC-123',
    type:        'exterior_damage',
    fileName:    '20260609_ABC-123_exterior_damage_1234.jpg',
    storagePath: '2026/06/09/ABC-123/20260609_ABC-123_damage_1234.jpg',
    internalUrl: 'http://internal/photos/20260609_ABC-123_damage_1234.jpg',
    uploadedBy:  '1',
    uploadedAt:  '2026-06-09T10:00:00.000Z',
    ...overrides,
  };
}

const app = createApp();

// ─── Default settings for upload tests ───────────────────────────────────────
const defaultSettings = {
  max_photo_size_mb:                5,
  shift_morning_start:              6,
  shift_afternoon_start:            14,
  shift_night_start:                22,
  no_review_days_threshold:         3,
  unusually_high_mileage_threshold: 500,
  unseen_alert_hours:               8,
};

// ─── GET /photos/file/* ───────────────────────────────────────────────────────

describe('GET /photos/file/* (servePhoto)', () => {
  const cookie = authCookie();
  const validPath = '2026/06/09/ABC-123/photo_1234.jpg';

  it('401 unauthenticated', async () => {
    const res = await request(app).get(`/photos/file/${validPath}`);
    expect(res.status).toBe(401);
  });

  it('404 when photo not in DB (storage path never reached)', async () => {
    mockGetPhotoByPath.mockResolvedValueOnce(null);
    const res = await request(app).get(`/photos/file/${validPath}`).set('Cookie', cookie);
    expect(res.status).toBe(404);
    expect(res.body.statusCode).toBe('NOT_FOUND');
  });

  it('200 serves file when DB record exists', async () => {
    mockGetPhotoByPath.mockResolvedValueOnce(photoRecord());
    const res = await request(app).get(`/photos/file/${validPath}`).set('Cookie', cookie);
    expect(res.status).toBe(200);
    // Mock serve() sets Content-Type: image/jpeg — confirms the storage layer was reached
    expect(res.headers['content-type']).toContain('image/jpeg');
  });

  it('DB record is looked up with the exact path received in the URL', async () => {
    mockGetPhotoByPath.mockResolvedValueOnce(photoRecord());
    await request(app).get(`/photos/file/${validPath}`).set('Cookie', cookie);
    expect(mockGetPhotoByPath).toHaveBeenCalledWith(validPath);
  });

  // ── Security: path traversal ─────────────────────────────────────────────
  // Express normalizes /photos/file/../../etc/passwd → /etc/passwd which does
  // NOT match the /photos/file/* wildcard. The controller is never reached,
  // so neither the DB lookup nor the storage driver is called. Even if a
  // crafted path did reach the controller, the DB lookup would find nothing
  // and return 404 — the disk/GCS driver is never touched.
  // IMPORTANT: do NOT set a mockResolvedValueOnce here — the handler never
  // runs so the mock would orphan in the queue and corrupt subsequent tests.
  it('path traversal attempt → 404 (Express path normalization blocks the route match)', async () => {
    const res = await request(app)
      .get('/photos/file/../../etc/passwd')
      .set('Cookie', cookie);
    expect(res.status).toBe(404);
    expect(mockGetPhotoByPath).not.toHaveBeenCalled();
  });

  it('empty path → 404 (not in DB)', async () => {
    // No mock needed — if the empty wildcard matches, the controller will call
    // getPhotoByStoragePath('') which returns undefined by default → 404.
    // If the wildcard requires ≥1 char, Express returns its own 404 without
    // hitting the controller. Either way: 404, no orphaned mock value.
    const res = await request(app).get('/photos/file/').set('Cookie', cookie);
    expect(res.status).toBe(404);
  });

  // ── Security: cross-tenant leakage ────────────────────────────────────────
  // getPhotoByStoragePath uses RLS — a photo belonging to another branch
  // returns null for a user outside that branch's scope, giving a 404.
  it('cross-tenant photo → 404 (RLS hides foreign record)', async () => {
    // Mock returns null as if RLS filtered out the row
    mockGetPhotoByPath.mockResolvedValueOnce(null);
    const foreignCookie = authCookie({ branchId: 99 });
    const res = await request(app).get(`/photos/file/${validPath}`).set('Cookie', foreignCookie);
    expect(res.status).toBe(404);
  });

  it('500 when storage.serve throws', async () => {
    mockGetPhotoByPath.mockResolvedValueOnce(photoRecord());
    const storageStub = {
      serve: jest.fn().mockRejectedValueOnce(new Error('GCS unavailable')),
      put:   jest.fn(),
    };
    mockGetStorage.mockReturnValueOnce(storageStub);
    const res = await request(app).get(`/photos/file/${validPath}`).set('Cookie', cookie);
    expect(res.status).toBe(500);
  });

  it('500 on DB failure in getPhotoByStoragePath', async () => {
    mockGetPhotoByPath.mockRejectedValueOnce(new Error('DB timeout'));
    const res = await request(app).get(`/photos/file/${validPath}`).set('Cookie', cookie);
    expect(res.status).toBe(500);
  });
});

// ─── POST /inspections/:id/photos (uploadPhoto) ───────────────────────────────

describe('POST /inspections/:id/photos (uploadPhoto)', () => {
  const cookie = authCookie({ userId: '1', role: 'guardia', branchId: 1 });
  const supCookie = supervisorCookie();

  beforeEach(() => {
    mockGetSettings.mockResolvedValue(defaultSettings);
    mockStorePhoto.mockResolvedValue({
      fileName:    '20260609_ABC-123_exterior_1234.jpg',
      storagePath: '2026/06/09/ABC-123/20260609_ABC-123_exterior_1234.jpg',
      internalUrl: 'http://internal/photos/20260609_ABC-123_exterior_1234.jpg',
    });
    mockCreatePhoto.mockResolvedValue({ id: '500' });
  });

  it('401 unauthenticated', async () => {
    const res = await request(app)
      .post('/inspections/100/photos')
      .attach('photo', JPEG_BUF, { filename: 'test.jpg', contentType: 'image/jpeg' });
    expect(res.status).toBe(401);
  });

  it('404 inspection not found', async () => {
    mockGetInspection.mockResolvedValueOnce(null);
    const res = await request(app)
      .post('/inspections/100/photos')
      .set('Cookie', cookie)
      .attach('photo', JPEG_BUF, { filename: 'test.jpg', contentType: 'image/jpeg' });
    expect(res.status).toBe(404);
    expect(res.body.statusCode).toBe('NOT_FOUND');
  });

  // ── Sealed inspection ────────────────────────────────────────────────────

  it('403 guardia cannot upload to sealed inspection (past shift)', async () => {
    // localDate differs from mocked '2026-06-09' → sealed
    mockGetInspection.mockResolvedValueOnce(
      inspectionRow({ localDate: '2026-06-08', shift: 'morning', branchId: 1 }),
    );
    const res = await request(app)
      .post('/inspections/100/photos')
      .set('Cookie', cookie)
      .attach('photo', JPEG_BUF, { filename: 'test.jpg', contentType: 'image/jpeg' });
    expect(res.status).toBe(403);
    expect(res.body.statusCode).toBe('INSPECTION_SEALED');
  });

  it('403 guardia cannot upload to sealed inspection (different shift same day)', async () => {
    // same date but shift differs
    mockGetInspection.mockResolvedValueOnce(
      inspectionRow({ localDate: '2026-06-09', shift: 'afternoon', branchId: 1 }),
    );
    const res = await request(app)
      .post('/inspections/100/photos')
      .set('Cookie', cookie)
      .attach('photo', JPEG_BUF, { filename: 'test.jpg', contentType: 'image/jpeg' });
    expect(res.status).toBe(403);
    expect(res.body.statusCode).toBe('INSPECTION_SEALED');
  });

  it('200 supervisor can upload to sealed inspection', async () => {
    mockGetInspection.mockResolvedValueOnce(
      inspectionRow({ localDate: '2026-06-08', shift: 'morning', branchId: 1 }),
    );
    const res = await request(app)
      .post('/inspections/100/photos')
      .set('Cookie', supCookie)
      .attach('photo', JPEG_BUF, { filename: 'test.jpg', contentType: 'image/jpeg' });
    expect(res.status).toBe(200);
  });

  it('200 guardia uploads to current (unsealed) inspection', async () => {
    mockGetInspection.mockResolvedValueOnce(
      inspectionRow({ localDate: '2026-06-09', shift: 'morning', branchId: 1 }),
    );
    const res = await request(app)
      .post('/inspections/100/photos')
      .set('Cookie', cookie)
      .attach('photo', JPEG_BUF, { filename: 'test.jpg', contentType: 'image/jpeg' });
    expect(res.status).toBe(200);
    expect(res.body.statusCode).toBe('PHOTO_UPLOADED');
    expect(res.body.data.photoId).toBe('500');
  });

  // ── File validation ───────────────────────────────────────────────────────

  it('400 no file attached', async () => {
    mockGetInspection.mockResolvedValueOnce(
      inspectionRow({ localDate: '2026-06-09', shift: 'morning', branchId: 1 }),
    );
    const res = await request(app)
      .post('/inspections/100/photos')
      .set('Cookie', cookie)
      .field('photoType', 'exterior');  // body field but no file
    expect(res.status).toBe(400);
    expect(res.body.statusCode).toBe('NO_FILE');
  });

  it('400 invalid MIME type (PDF)', async () => {
    mockGetInspection.mockResolvedValueOnce(
      inspectionRow({ localDate: '2026-06-09', shift: 'morning', branchId: 1 }),
    );
    const res = await request(app)
      .post('/inspections/100/photos')
      .set('Cookie', cookie)
      .attach('photo', JPEG_BUF, { filename: 'invoice.pdf', contentType: 'application/pdf' });
    expect(res.status).toBe(400);
    expect(res.body.statusCode).toBe('INVALID_FORMAT');
  });

  it('400 invalid MIME type (video/mp4)', async () => {
    mockGetInspection.mockResolvedValueOnce(
      inspectionRow({ localDate: '2026-06-09', shift: 'morning', branchId: 1 }),
    );
    const res = await request(app)
      .post('/inspections/100/photos')
      .set('Cookie', cookie)
      .attach('photo', JPEG_BUF, { filename: 'clip.mp4', contentType: 'video/mp4' });
    expect(res.status).toBe(400);
    expect(res.body.statusCode).toBe('INVALID_FORMAT');
  });

  // ── Security: MIME spoofing via magic bytes ────────────────────────────────
  // A PDF (or ZIP) claiming to be JPEG must be rejected. The MIME check
  // passes (image/jpeg is allowed) but validateMagicBytes inspects the
  // actual file header and rejects non-image content.
  it('400 MIME spoofing: PDF disguised as image/jpeg', async () => {
    mockGetInspection.mockResolvedValueOnce(
      inspectionRow({ localDate: '2026-06-09', shift: 'morning', branchId: 1 }),
    );
    const res = await request(app)
      .post('/inspections/100/photos')
      .set('Cookie', cookie)
      // MIME says jpeg but content is a PDF
      .attach('photo', PDF_DISGUISED_AS_JPEG, { filename: 'fake.jpg', contentType: 'image/jpeg' });
    expect(res.status).toBe(400);
    expect(res.body.statusCode).toBe('INVALID_FILE_CONTENT');
  });

  it('400 MIME spoofing: ZIP disguised as image/png', async () => {
    mockGetInspection.mockResolvedValueOnce(
      inspectionRow({ localDate: '2026-06-09', shift: 'morning', branchId: 1 }),
    );
    const res = await request(app)
      .post('/inspections/100/photos')
      .set('Cookie', cookie)
      .attach('photo', ZIP_BUF, { filename: 'shell.png', contentType: 'image/png' });
    expect(res.status).toBe(400);
    expect(res.body.statusCode).toBe('INVALID_FILE_CONTENT');
  });

  it('400 buffer too small to have valid magic bytes', async () => {
    mockGetInspection.mockResolvedValueOnce(
      inspectionRow({ localDate: '2026-06-09', shift: 'morning', branchId: 1 }),
    );
    const res = await request(app)
      .post('/inspections/100/photos')
      .set('Cookie', cookie)
      .attach('photo', TINY_BUF, { filename: 'empty.jpg', contentType: 'image/jpeg' });
    expect(res.status).toBe(400);
    expect(res.body.statusCode).toBe('INVALID_FILE_CONTENT');
  });

  // ── Per-branch size limit ─────────────────────────────────────────────────
  it('400 file exceeds per-branch max_photo_size_mb setting', async () => {
    // Set branch limit to 1 byte so any real buffer exceeds it
    mockGetSettings.mockResolvedValue({ ...defaultSettings, max_photo_size_mb: 1 / (1024 * 1024) });
    mockGetInspection.mockResolvedValueOnce(
      inspectionRow({ localDate: '2026-06-09', shift: 'morning', branchId: 1 }),
    );
    const res = await request(app)
      .post('/inspections/100/photos')
      .set('Cookie', cookie)
      .attach('photo', JPEG_BUF, { filename: 'big.jpg', contentType: 'image/jpeg' });
    expect(res.status).toBe(400);
    expect(res.body.statusCode).toBe('FILE_TOO_LARGE');
  });

  // ── Valid formats ─────────────────────────────────────────────────────────
  it('200 accepts PNG format', async () => {
    mockGetInspection.mockResolvedValueOnce(
      inspectionRow({ localDate: '2026-06-09', shift: 'morning', branchId: 1 }),
    );
    const res = await request(app)
      .post('/inspections/100/photos')
      .set('Cookie', cookie)
      .attach('photo', PNG_BUF, { filename: 'damage.png', contentType: 'image/png' });
    expect(res.status).toBe(200);
  });

  it('200 accepts WebP format', async () => {
    mockGetInspection.mockResolvedValueOnce(
      inspectionRow({ localDate: '2026-06-09', shift: 'morning', branchId: 1 }),
    );
    const res = await request(app)
      .post('/inspections/100/photos')
      .set('Cookie', cookie)
      .attach('photo', WEBP_BUF, { filename: 'photo.webp', contentType: 'image/webp' });
    expect(res.status).toBe(200);
  });

  // ── Photo type ────────────────────────────────────────────────────────────
  it('defaults photoType to "other" when not provided in body', async () => {
    mockGetInspection.mockResolvedValueOnce(
      inspectionRow({ localDate: '2026-06-09', shift: 'morning', branchId: 1 }),
    );
    const res = await request(app)
      .post('/inspections/100/photos')
      .set('Cookie', cookie)
      .attach('photo', JPEG_BUF, { filename: 'test.jpg', contentType: 'image/jpeg' });
    expect(res.status).toBe(200);
    expect(mockStorePhoto).toHaveBeenCalledWith(
      expect.any(Buffer),
      expect.any(String),
      'other',
    );
  });

  it('uses photoType from body when provided (valid enum value)', async () => {
    mockGetInspection.mockResolvedValueOnce(
      inspectionRow({ localDate: '2026-06-09', shift: 'morning', branchId: 1 }),
    );
    const res = await request(app)
      .post('/inspections/100/photos')
      .set('Cookie', cookie)
      .attach('photo', JPEG_BUF, { filename: 'test.jpg', contentType: 'image/jpeg' })
      .field('photoType', 'exterior_damage');  // valid PhotoType value
    expect(res.status).toBe(200);
    expect(mockStorePhoto).toHaveBeenCalledWith(
      expect.any(Buffer), expect.any(String), 'exterior_damage',
    );
  });

  // ── Security: photoType injection prevention ────────────────────────────────
  // Client cannot inject arbitrary strings as photoType. Only values from the
  // PhotoType enum are accepted; any other value → 400 INVALID_PHOTO_TYPE.
  it('400 when unknown photoType string is provided', async () => {
    mockGetInspection.mockResolvedValueOnce(
      inspectionRow({ localDate: '2026-06-09', shift: 'morning', branchId: 1 }),
    );
    const res = await request(app)
      .post('/inspections/100/photos')
      .set('Cookie', cookie)
      .attach('photo', JPEG_BUF, { filename: 'test.jpg', contentType: 'image/jpeg' })
      .field('photoType', 'injected_custom_type');
    expect(res.status).toBe(400);
    expect(res.body.statusCode).toBe('INVALID_PHOTO_TYPE');
  });

  // ── Security: vehicle identity injection prevention ────────────────────────
  // The controller must use vehicleId and plate from the DB inspection record,
  // NOT from the request body. A malicious user cannot attach a photo to a
  // different vehicle by injecting vehicleId in the form body.
  it('vehicle plate taken from DB inspection, not from request body', async () => {
    const insp = inspectionRow({
      localDate: '2026-06-09', shift: 'morning', branchId: 1,
      vehicleId: '10', plate: 'ABC-123',
    });
    mockGetInspection.mockResolvedValueOnce(insp);
    await request(app)
      .post('/inspections/100/photos')
      .set('Cookie', cookie)
      .attach('photo', JPEG_BUF, { filename: 'test.jpg', contentType: 'image/jpeg' })
      .field('vehicleId', '999')    // attempt injection
      .field('plate', 'HACKED');   // attempt injection
    // createPhotoRecord must use DB values, not body values
    expect(mockCreatePhoto).toHaveBeenCalledWith(
      expect.objectContaining({ vehicleId: '10', plate: 'ABC-123' }),
    );
  });

  // ── markHasPhotos called ──────────────────────────────────────────────────
  it('markHasPhotos is called after successful upload', async () => {
    mockGetInspection.mockResolvedValueOnce(
      inspectionRow({ localDate: '2026-06-09', shift: 'morning', branchId: 1 }),
    );
    await request(app)
      .post('/inspections/100/photos')
      .set('Cookie', cookie)
      .attach('photo', JPEG_BUF, { filename: 'test.jpg', contentType: 'image/jpeg' });
    expect(mockMarkHasPhotos).toHaveBeenCalledWith('100');
  });

  // ── DB and storage failures ───────────────────────────────────────────────
  it('500 when storePhoto fails', async () => {
    mockGetInspection.mockResolvedValueOnce(
      inspectionRow({ localDate: '2026-06-09', shift: 'morning', branchId: 1 }),
    );
    mockStorePhoto.mockRejectedValueOnce(new Error('GCS write error'));
    const res = await request(app)
      .post('/inspections/100/photos')
      .set('Cookie', cookie)
      .attach('photo', JPEG_BUF, { filename: 'test.jpg', contentType: 'image/jpeg' });
    expect(res.status).toBe(500);
  });

  it('500 when createPhotoRecord fails', async () => {
    mockGetInspection.mockResolvedValueOnce(
      inspectionRow({ localDate: '2026-06-09', shift: 'morning', branchId: 1 }),
    );
    mockCreatePhoto.mockRejectedValueOnce(new Error('DB insert failed'));
    const res = await request(app)
      .post('/inspections/100/photos')
      .set('Cookie', cookie)
      .attach('photo', JPEG_BUF, { filename: 'test.jpg', contentType: 'image/jpeg' });
    expect(res.status).toBe(500);
  });

  it('500 on getTypedSettings failure', async () => {
    mockGetInspection.mockResolvedValueOnce(
      inspectionRow({ localDate: '2026-06-09', shift: 'morning', branchId: 1 }),
    );
    mockGetSettings.mockRejectedValueOnce(new Error('DB timeout'));
    const res = await request(app)
      .post('/inspections/100/photos')
      .set('Cookie', cookie)
      .attach('photo', JPEG_BUF, { filename: 'test.jpg', contentType: 'image/jpeg' });
    expect(res.status).toBe(500);
  });
});

// ─── GET /inspections/:id/photos (getInspectionPhotos) ───────────────────────

describe('GET /inspections/:id/photos (getInspectionPhotos)', () => {
  const cookie = authCookie({ role: 'guardia', branchId: 1 });

  it('401 unauthenticated', async () => {
    const res = await request(app).get('/inspections/100/photos');
    expect(res.status).toBe(401);
  });

  it('404 inspection not found (getInspectionById returns null)', async () => {
    mockGetInspection.mockResolvedValueOnce(null);
    const res = await request(app).get('/inspections/100/photos').set('Cookie', cookie);
    expect(res.status).toBe(404);
    expect(res.body.statusCode).toBe('NOT_FOUND');
  });

  it('404 inspection outside caller scope (getInspectionById returns null for out-of-scope)', async () => {
    // Scope is enforced inside getInspectionById — returns null for rows
    // outside the caller's RLS scope. The controller treats null as 404.
    mockGetInspection.mockResolvedValueOnce(null);
    const foreignCookie = authCookie({ role: 'guardia', branchId: 99 });
    const res = await request(app)
      .get('/inspections/100/photos')
      .set('Cookie', foreignCookie);
    expect(res.status).toBe(404);
  });

  it('200 returns photo list for inspection', async () => {
    mockGetInspection.mockResolvedValueOnce(inspectionRow({ branchId: 1 }));
    mockGetPhotosByInsp.mockResolvedValueOnce([photoRecord(), photoRecord({ id: '501' })]);
    const res = await request(app).get('/inspections/100/photos').set('Cookie', cookie);
    expect(res.status).toBe(200);
    expect(res.body.data).toHaveLength(2);
  });

  it('200 returns empty array when inspection has no photos', async () => {
    mockGetInspection.mockResolvedValueOnce(inspectionRow({ branchId: 1 }));
    mockGetPhotosByInsp.mockResolvedValueOnce([]);
    const res = await request(app).get('/inspections/100/photos').set('Cookie', cookie);
    expect(res.status).toBe(200);
    expect(res.body.data).toHaveLength(0);
  });

  it('getPhotosByInspection called with the correct inspectionId', async () => {
    mockGetInspection.mockResolvedValueOnce(inspectionRow({ branchId: 1 }));
    mockGetPhotosByInsp.mockResolvedValueOnce([]);
    await request(app).get('/inspections/100/photos').set('Cookie', cookie);
    expect(mockGetPhotosByInsp).toHaveBeenCalledWith('100');
  });

  it('all supervisor roles can retrieve photos', async () => {
    for (const role of ['jefe_operaciones', 'admin', 'admin_pais', 'admin_global'] as const) {
      mockGetInspection.mockResolvedValueOnce(inspectionRow({ branchId: 1 }));
      mockGetPhotosByInsp.mockResolvedValueOnce([photoRecord()]);
      const res = await request(app)
        .get('/inspections/100/photos')
        .set('Cookie', authCookie({ role, branchId: 1, countryId: 1 }));
      expect(res.status).toBe(200);
    }
  });

  it('500 on DB failure in getPhotosByInspection', async () => {
    mockGetInspection.mockResolvedValueOnce(inspectionRow({ branchId: 1 }));
    mockGetPhotosByInsp.mockRejectedValueOnce(new Error('DB connection lost'));
    const res = await request(app).get('/inspections/100/photos').set('Cookie', cookie);
    expect(res.status).toBe(500);
  });

  it('500 on DB failure in getInspectionById', async () => {
    mockGetInspection.mockRejectedValueOnce(new Error('DB timeout'));
    const res = await request(app).get('/inspections/100/photos').set('Cookie', cookie);
    expect(res.status).toBe(500);
  });
});
