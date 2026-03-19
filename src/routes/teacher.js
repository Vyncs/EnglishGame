import { Router } from 'express';
import { authMiddleware, teacherOnly } from '../middleware/auth.js';
import {
  getDashboard,
  getStudents,
  getMaterials,
  createMaterial,
  updateMaterial,
  deleteMaterial,
  assignMaterial,
  unassignMaterial,
} from '../controllers/teacherController.js';

const router = Router();

router.use(authMiddleware, teacherOnly);

router.get('/dashboard', getDashboard);
router.get('/students', getStudents);
router.get('/materials', getMaterials);
router.post('/materials', createMaterial);
router.patch('/materials/:id', updateMaterial);
router.delete('/materials/:id', deleteMaterial);
router.post('/materials/:id/assign', assignMaterial);
router.delete('/materials/:id/assign/:studentId', unassignMaterial);

export default router;
