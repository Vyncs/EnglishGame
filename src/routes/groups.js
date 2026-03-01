import { Router } from 'express';
import prisma from '../db.js';
import { authMiddleware } from '../middleware/auth.js';

const router = Router();
router.use(authMiddleware);

export function toGroupResponse(g) {
  return {
    id: g.id,
    name: g.name,
    createdAt: g.createdAt.getTime(),
  };
}

// GET /api/groups
router.get('/', async (req, res, next) => {
  try {
    const list = await prisma.group.findMany({
      where: { userId: req.user.id },
      orderBy: { createdAt: 'asc' },
    });
    res.json(list.map(toGroupResponse));
  } catch (e) {
    next(e);
  }
});

// POST /api/groups
router.post('/', async (req, res, next) => {
  try {
    const { name } = req.body;
    if (!name || typeof name !== 'string') {
      return res.status(400).json({ error: 'Nome é obrigatório' });
    }
    const group = await prisma.group.create({
      data: { name: name.trim(), userId: req.user.id },
    });
    res.status(201).json(toGroupResponse(group));
  } catch (e) {
    next(e);
  }
});

// PATCH /api/groups/:id
router.patch('/:id', async (req, res, next) => {
  try {
    const { name } = req.body;
    if (!name || typeof name !== 'string') {
      return res.status(400).json({ error: 'Nome é obrigatório' });
    }
    const group = await prisma.group.findFirst({
      where: { id: req.params.id, userId: req.user.id },
    });
    if (!group) return res.status(404).json({ error: 'Grupo não encontrado' });
    const updated = await prisma.group.update({
      where: { id: req.params.id },
      data: { name: name.trim() },
    });
    res.json(toGroupResponse(updated));
  } catch (e) {
    next(e);
  }
});

// DELETE /api/groups/:id
router.delete('/:id', async (req, res, next) => {
  try {
    const group = await prisma.group.findFirst({
      where: { id: req.params.id, userId: req.user.id },
    });
    if (!group) return res.status(404).json({ error: 'Grupo não encontrado' });
    await prisma.group.delete({ where: { id: req.params.id } });
    res.status(204).send();
  } catch (e) {
    next(e);
  }
});

export default router;
