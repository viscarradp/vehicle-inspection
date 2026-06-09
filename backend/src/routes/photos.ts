import { Router } from 'express';
import { requireAuth } from '../middleware/auth';
import { servePhoto } from '../controllers/photoController';

const router = Router();
router.use(requireAuth);

// Authenticated file serving — replaces the old public /uploads/ static route
router.get('/file/*', servePhoto);

export default router;
