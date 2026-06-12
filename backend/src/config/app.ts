import express from 'express';
import cors from 'cors';
import cookieParser from 'cookie-parser';
import helmet from 'helmet';
import path from 'path';
import rateLimit from 'express-rate-limit';
import { errorHandler } from '../middleware/errorHandler';
import { dbContextMiddleware } from '../middleware/dbContext';
import authRoutes from '../routes/auth';
import vehicleRoutes from '../routes/vehicles';
import driverRoutes from '../routes/drivers';
import inspectionRoutes from '../routes/inspections';
import photoRoutes from '../routes/photos';
import openIssueRoutes from '../routes/openIssues';
import reportRoutes from '../routes/reports';
import auditRoutes from '../routes/audit';
import settingsRoutes from '../routes/settings';
import adminRoutes from '../routes/admin';
import branchRoutes from '../routes/branches';
import countryRoutes from '../routes/countries';
import vehicleStatusTypeRoutes from '../routes/vehicleStatusTypes';

export function createApp() {
  const app = express();

  const isProd = process.env.NODE_ENV === 'production';
  const isHttps = (process.env.PUBLIC_BASE_URL ?? '').startsWith('https://');

  // ── Trust proxy (nginx sits in front) ───────────────────────────
  if (isProd) app.set('trust proxy', 1);

  // ── Security headers (Helmet) ────────────────────────────────────
  app.use(helmet({
    contentSecurityPolicy: isProd ? {
      directives: {
        defaultSrc: ["'self'"],
        scriptSrc: ["'self'", "'unsafe-inline'"],  // needed by Vite SPA
        styleSrc: ["'self'", "'unsafe-inline'", 'https://fonts.googleapis.com'],
        fontSrc: ["'self'", 'https://fonts.gstatic.com'],
        imgSrc: ["'self'", 'data:', 'blob:'],
        connectSrc: ["'self'"],
        objectSrc: ["'none'"],
        upgradeInsecureRequests: isHttps ? [] : null,
      },
    } : false,
    hsts: isHttps ? { maxAge: 31536000, includeSubDomains: true, preload: true } : false,
    referrerPolicy: { policy: 'strict-origin-when-cross-origin' },
    crossOriginOpenerPolicy: { policy: 'same-origin' },
  }));

  // ── CORS — restrict to declared origin in production ────────────
  const allowedOrigin = process.env.ALLOWED_ORIGIN ?? (isProd ? '' : 'http://localhost:5173');
  // Matches http(s)://192.168.<anything> for local-network access
  const localNetworkOrigin = /^https?:\/\/192\.168\.\d{1,3}\.\d{1,3}(:\d+)?$/;
  app.use(cors({
    origin: isProd
      ? (origin, cb) => {
          if (!origin) return cb(null, true);
          if (origin === allowedOrigin || localNetworkOrigin.test(origin)) return cb(null, true);
          cb(new Error(`CORS: origin ${origin} not allowed`));
        }
      : allowedOrigin,
    credentials: true,
    methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization'],
  }));

  // ── Cookie parser ────────────────────────────────────────────────
  app.use(cookieParser());

  // ── Body parsers — tight limits ──────────────────────────────────
  app.use(express.json({ limit: '1mb' }));          // API payloads are small
  app.use(express.urlencoded({ extended: true, limit: '1mb' }));

  // ── Rate limiters ────────────────────────────────────────────────
  // Global: 200 req / 15 min per IP across all API routes
  const globalLimiter = rateLimit({
    windowMs: 5 * 60 * 1000,
    max: 500,
    standardHeaders: true,
    legacyHeaders: false,
    message: { success: false, statusCode: 'RATE_LIMITED', message: 'Demasiadas solicitudes. Intente más tarde.' },
  });

  // Login: max 8 attempts / 15 min (brute-force protection)
  const loginLimiter = rateLimit({
    windowMs: 15 * 60 * 1000,
    max: 8,
    standardHeaders: true,
    legacyHeaders: false,
    message: { success: false, statusCode: 'RATE_LIMITED', message: 'Demasiados intentos de acceso. Espere 15 minutos.' },
    skipSuccessfulRequests: true,  // only count failed attempts
  });

  // ── Health check (no auth needed, used by load balancer) ────────
  app.get('/health', (_req, res) => {
    res.json({ status: 'ok', timestamp: new Date().toISOString() });
  });

  // NOTE: /uploads/ is NOT served as public static.
  // Photos are served via authenticated GET /photos/file/* endpoint.

  // ── Per-request DB transaction (required for RLS SESSION_CONTEXT) ───────
  app.use(dbContextMiddleware);

  // ── API routes — apply global limiter first ───────────────────────
  // Mounted at both / (dev: proxy strips /api) and /api (prod: same-server)
  const apiPrefixes = ['', '/api'];
  for (const prefix of apiPrefixes) {
    app.use(`${prefix}/`, globalLimiter);
    app.use(`${prefix}/auth/login`, loginLimiter);
    app.use(`${prefix}/auth`, authRoutes);
    app.use(`${prefix}/vehicles`, vehicleRoutes);
    app.use(`${prefix}/drivers`, driverRoutes);
    app.use(`${prefix}/inspections`, inspectionRoutes);
    app.use(`${prefix}/photos`, photoRoutes);
    app.use(`${prefix}/open-issues`, openIssueRoutes);
    app.use(`${prefix}/reports`, reportRoutes);
    app.use(`${prefix}/audit-logs`, auditRoutes);
    app.use(`${prefix}/settings`, settingsRoutes);
    app.use(`${prefix}/admin`, adminRoutes);
    app.use(`${prefix}/branches`, branchRoutes);
    app.use(`${prefix}/countries`, countryRoutes);
    app.use(`${prefix}/vehicle-status-types`, vehicleStatusTypeRoutes);
  }

  // ── Frontend SPA (production only) ───────────────────────────────
  if (isProd) {
    const publicDir = path.join(process.cwd(), 'public');
    app.use(express.static(publicDir, { maxAge: '1d', index: false }));
    app.get('*', (req, res, next) => {
      if (req.path.startsWith('/api/') || req.path.startsWith('/uploads/') || req.path === '/health') {
        return next();
      }
      res.sendFile(path.join(publicDir, 'index.html'));
    });
  }

  app.use(errorHandler);
  return app;
}
