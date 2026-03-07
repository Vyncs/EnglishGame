import { Router } from 'express';
import { authMiddleware, adminOnly } from '../middleware/auth.js';
import {
  getMetrics,
  getCharts,
  getUsers,
  patchUser,
  removeUser,
  getFinancial,
} from '../controllers/adminController.js';

const router = Router();

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
