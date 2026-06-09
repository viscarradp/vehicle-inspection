/** @type {import('jest').Config} */
module.exports = {
  testEnvironment: 'node',
  roots: ['<rootDir>/src'],
  testMatch: ['**/__tests__/**/*.test.ts'],
  // transpile-only (no full type-check): keeps the suite fast and immune to
  // unrelated type errors elsewhere in the repo. `tsc` / the IDE still type-check.
  transform: {
    '^.+\\.ts$': ['ts-jest', { tsconfig: 'tsconfig.jest.json' }],
  },
  moduleFileExtensions: ['ts', 'js', 'json'],
  // uuid v11 is ESM-only and pulled in transitively (exceljs). Map it to a CJS
  // stub so the full app module graph can be imported under Jest/CommonJS.
  moduleNameMapper: {
    '^uuid$': '<rootDir>/jest.uuidStub.js',
  },
  // Sets JWT_SECRET / NODE_ENV before any app module is imported.
  setupFiles: ['<rootDir>/src/__tests__/setupEnv.ts'],
  // Reset call counts between tests; implementations are re-seeded in beforeEach.
  clearMocks: true,
};
