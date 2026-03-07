import { Router } from 'express';
import { authMiddleware, adminOnly } from '../middleware/auth.js';
import { getMetrics, getCharts } from '../controllers/adminController.js';

const router = Router();

router.use(authMiddleware, adminOnly);

router.get('/metrics', getMetrics);
router.get('/charts', getCharts);

export default router;
