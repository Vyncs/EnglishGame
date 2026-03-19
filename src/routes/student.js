import { Router } from 'express';
import { authMiddleware } from '../middleware/auth.js';
import prisma from '../db.js';

const router = Router();

router.use(authMiddleware);

// GET /api/student/teachers — lista professores vinculados ao aluno
router.get('/teachers', async (req, res, next) => {
  try {
    const records = await prisma.teacherStudent.findMany({
      where: { studentId: req.user.id },
      include: {
        teacher: {
          select: { id: true, email: true, name: true, couponCode: true },
        },
      },
    });

    res.json(
      records.map((r) => ({
        id: r.teacher.id,
        email: r.teacher.email,
        name: r.teacher.name,
        joinedAt: r.joinedAt,
      }))
    );
  } catch (e) {
    next(e);
  }
});

// GET /api/student/materials — lista materiais atribuídos ao aluno
router.get('/materials', async (req, res, next) => {
  try {
    const assignments = await prisma.materialAssignment.findMany({
      where: { studentId: req.user.id },
      orderBy: { assignedAt: 'desc' },
      include: {
        material: {
          include: {
            teacher: { select: { id: true, name: true, email: true } },
          },
        },
      },
    });

    res.json(
      assignments.map((a) => ({
        id: a.material.id,
        title: a.material.title,
        description: a.material.description,
        type: a.material.type,
        url: a.material.url,
        content: a.material.content,
        createdAt: a.material.createdAt,
        assignedAt: a.assignedAt,
        teacher: a.material.teacher,
      }))
    );
  } catch (e) {
    next(e);
  }
});

// GET /api/student/has-teacher — verifica se o aluno tem professor vinculado
router.get('/has-teacher', async (req, res, next) => {
  try {
    const count = await prisma.teacherStudent.count({
      where: { studentId: req.user.id },
    });
    res.json({ hasTeacher: count > 0 });
  } catch (e) {
    next(e);
  }
});

export default router;
