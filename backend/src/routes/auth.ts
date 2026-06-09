import { Router } from 'express';
import { login, logout, me, guards } from '../controllers/authController';
import { requireAuth } from '../middleware/auth';

const router = Router();

router.post('/login', login);
router.post('/logout', requireAuth, logout);
router.get('/me', requireAuth, me);
router.get('/guards', requireAuth, guards); // protected: only used by admin panel

export default router;
