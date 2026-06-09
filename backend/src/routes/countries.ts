import { Router } from 'express';
import { requireAuth } from '../middleware/auth';
import { requireRole } from '../middleware/roles';
import {
  getCountries,
  getCountryById,
  createCountry,
  updateCountry,
  setCountryActive,
} from '../db/countries';

const router = Router();

// Countries are structural configuration — only admin_global can write.
// Reads are open to all authenticated users (needed to populate selects in the UI).
router.use(requireAuth);
const requireGlobal = requireRole('admin_global');

function isValidIANATimezone(tz: string): boolean {
  try {
    Intl.DateTimeFormat(undefined, { timeZone: tz });
    return true;
  } catch {
    return false;
  }
}

// ─── Read ─────────────────────────────────────────────────────────────────────

router.get('/', async (_req, res, next) => {
  try {
    const countries = await getCountries();
    res.json({ success: true, statusCode: 'OK', message: `${countries.length} país(es).`, uiState: 'saved_successfully', data: countries });
  } catch (err) { next(err); }
});

// ─── Write ────────────────────────────────────────────────────────────────────

router.post('/', requireGlobal, async (req, res, next) => {
  try {
    const { code, name, timezone } = req.body;

    if (!code || !name || !timezone) {
      res.status(400).json({ success: false, statusCode: 'MISSING_FIELDS', message: 'Código, nombre y zona horaria son obligatorios.', uiState: 'validation_error' });
      return;
    }
    if (!isValidIANATimezone(timezone)) {
      res.status(400).json({ success: false, statusCode: 'INVALID_TIMEZONE', message: 'Zona horaria IANA inválida. Ejemplo: "America/Guatemala".', uiState: 'validation_error' });
      return;
    }

    const country = await createCountry({ code, name, timezone });
    res.status(201).json({ success: true, statusCode: 'COUNTRY_CREATED', message: 'País creado.', uiState: 'saved_successfully', data: country });
  } catch (err) { next(err); }
});

router.put('/:id', requireGlobal, async (req, res, next) => {
  try {
    const id = parseInt(req.params.id, 10);
    await getCountryById(id);  // throws AppError(404) if not found
    const { name, timezone } = req.body;
    if (timezone !== undefined && !isValidIANATimezone(timezone)) {
      res.status(400).json({ success: false, statusCode: 'INVALID_TIMEZONE', message: 'Zona horaria IANA inválida. Ejemplo: "America/Guatemala".', uiState: 'validation_error' });
      return;
    }
    await updateCountry(id, { name, timezone });
    res.json({ success: true, statusCode: 'COUNTRY_UPDATED', message: 'País actualizado.', uiState: 'saved_successfully' });
  } catch (err) { next(err); }
});

router.patch('/:id/activate', requireGlobal, async (req, res, next) => {
  try {
    const id = parseInt(req.params.id, 10);
    await getCountryById(id);
    await setCountryActive(id, true);
    res.json({ success: true, statusCode: 'COUNTRY_ACTIVATED', message: 'País activado.', uiState: 'saved_successfully' });
  } catch (err) { next(err); }
});

router.patch('/:id/deactivate', requireGlobal, async (req, res, next) => {
  try {
    const id = parseInt(req.params.id, 10);
    await getCountryById(id);
    await setCountryActive(id, false);
    res.json({ success: true, statusCode: 'COUNTRY_DEACTIVATED', message: 'País desactivado.', uiState: 'saved_successfully' });
  } catch (err) { next(err); }
});

export default router;
