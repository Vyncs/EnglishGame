import { Router } from 'express';
import prisma from '../db.js';
import { authMiddleware } from '../middleware/auth.js';
import { isPremiumUser } from '../utils/subscription.js';

const FREE_AI_STORIES_PER_LEVEL = 2;

function isAiGeneratedBook(b) {
  if (!b || typeof b !== 'object' || !b.isCustom) return false;
  const a = String(b.author || '');
  return a.includes('Groq') || a.includes('IA (');
}

function countAiStoriesByLevel(customBooks) {
  const counts = { A1: 0, A2: 0, B1: 0, B2: 0 };
  for (const b of customBooks) {
    if (!isAiGeneratedBook(b)) continue;
    const lvl = b.level;
    if (lvl in counts) counts[lvl] += 1;
  }
  return counts;
}

const router = Router();
router.use(authMiddleware);

// PUT /api/books — substitui lista de livros customizados
router.put('/', async (req, res, next) => {
  try {
    const customBooks = Array.isArray(req.body.customBooks) ? req.body.customBooks : [];
    if (!isPremiumUser(req.user)) {
      const counts = countAiStoriesByLevel(customBooks);
      for (const lvl of ['A1', 'A2', 'B1', 'B2']) {
        if (counts[lvl] > FREE_AI_STORIES_PER_LEVEL) {
          return res.status(403).json({
            error: `Plano free: no máximo ${FREE_AI_STORIES_PER_LEVEL} histórias por IA por nível (${lvl}).`,
            code: 'FREE_AI_STORY_LIMIT',
          });
        }
      }
    }
    const books = JSON.stringify(customBooks);
    await prisma.userCustomBooks.upsert({
      where: { userId: req.user.id },
      create: { userId: req.user.id, books },
      update: { books },
    });
    res.json({ ok: true });
  } catch (e) {
    next(e);
  }
});

export default router;
