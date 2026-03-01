import { Router } from 'express';
import prisma from '../db.js';
import { authMiddleware } from '../middleware/auth.js';

const router = Router();
router.use(authMiddleware);

// PUT /api/books — substitui lista de livros customizados
router.put('/', async (req, res, next) => {
  try {
    const customBooks = Array.isArray(req.body.customBooks) ? req.body.customBooks : [];
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
