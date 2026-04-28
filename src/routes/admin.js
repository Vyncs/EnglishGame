import { Router } from 'express';
import { authMiddleware, adminOnly } from '../middleware/auth.js';
import { jobsAuth } from '../middleware/jobsAuth.js';
import { expireSubscriptions } from '../services/subscriptionService.js';
import {
  getMetrics,
  getCharts,
  getUsers,
  patchUser,
  removeUser,
  getFinancial,
} from '../controllers/adminController.js';

const router = Router();

// ─── JOBS (cron externo) ──────────────────────────────────────────────────
// Autenticação via header x-jobs-secret (NÃO usa JWT, NÃO depende de role).
// Montadas ANTES do router.use(authMiddleware) para escapar do middleware global.
router.post('/jobs/expire-subscriptions', jobsAuth, async (req, res, next) => {
  try {
    const result = await expireSubscriptions();
    console.log(
      `[jobs] expire-subscriptions: ${result.expiredCount} users rebaixados em ${result.scannedAt}`,
    );
    res.json(result);
  } catch (e) {
    next(e);
  }
});

// ─── ADMIN UI (JWT + role=ADMIN) ──────────────────────────────────────────
router.use(authMiddleware, adminOnly);

// Dashboard
router.get('/metrics', getMetrics);
router.get('/charts', getCharts);

// Users CRUD
router.get('/users', getUsers);
router.patch('/users/:id', patchUser);
router.delete('/users/:id', removeUser);

// Financial
router.get('/financial', getFinancial);

export default router;
