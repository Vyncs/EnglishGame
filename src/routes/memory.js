import { Router } from 'express';
import prisma from '../db.js';
import { authMiddleware } from '../middleware/auth.js';

const router = Router();
router.use(authMiddleware);

// PUT /api/memory — substitui decks e hiddenDefaultDeckIds
router.put('/', async (req, res, next) => {
  try {
    const { memoryDecks = [], hiddenDefaultDeckIds = [] } = req.body;
    const decks = JSON.stringify(Array.isArray(memoryDecks) ? memoryDecks : []);
    const hidden = JSON.stringify(Array.isArray(hiddenDefaultDeckIds) ? hiddenDefaultDeckIds : []);
    await prisma.userMemoryData.upsert({
      where: { userId: req.user.id },
      create: { userId: req.user.id, decks, hiddenDefaultDeckIds: hidden },
      update: { decks, hiddenDefaultDeckIds: hidden },
    });
    res.json({ ok: true });
  } catch (e) {
    next(e);
  }
});

export default router;
