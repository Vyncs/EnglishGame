import { Router } from 'express';
import prisma from '../db.js';
import { authMiddleware } from '../middleware/auth.js';
import { isPremiumUser } from '../utils/subscription.js';

const router = Router();
router.use(authMiddleware);

// PUT /api/memory — substitui decks e hiddenDefaultDeckIds
router.put('/', async (req, res, next) => {
  try {
    if (!isPremiumUser(req.user)) {
      return res.status(403).json({
        error: 'Gerenciar decks de memória é exclusivo de assinantes.',
        code: 'MEMORY_MANAGE_PREMIUM_ONLY',
      });
    }
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
