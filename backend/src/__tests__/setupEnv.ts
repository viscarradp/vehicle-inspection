// Runs (via jest `setupFiles`) BEFORE any application module is imported, so the
// values are in place when requireAuth / authController read process.env.
//
// Note: index.ts (which validates env and connects to SQL Server) is never
// imported by the tests — we import `createApp` directly — so no real DB or
// network is touched.
process.env.NODE_ENV = 'test';
process.env.JWT_SECRET = 'test-jwt-secret-at-least-32-characters-long-0123456789';
process.env.JWT_EXPIRES_IN = '12h';
