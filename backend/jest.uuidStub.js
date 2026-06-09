// uuid v11 ships as ESM-only, which Jest will not transpile from node_modules.
// It's pulled in transitively (exceljs → uuid) when createApp() loads every
// route. The auth tests never generate a UUID, so we map `uuid` to this tiny
// CJS stub via moduleNameMapper to keep the module graph importable.
const FIXED = '00000000-0000-0000-0000-000000000000';
module.exports = {
  v1: () => FIXED,
  v3: () => FIXED,
  v4: () => FIXED,
  v5: () => FIXED,
  NIL: FIXED,
  validate: () => true,
  version: () => 4,
  parse: () => Buffer.alloc(16),
  stringify: () => FIXED,
};
