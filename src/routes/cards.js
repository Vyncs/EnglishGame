import { Router } from 'express';
import prisma from '../db.js';
import { authMiddleware } from '../middleware/auth.js';

const router = Router();
router.use(authMiddleware);

export function toCardResponse(c) {
  return {
    id: c.id,
    groupId: c.groupId,
    portuguesePhrase: c.portuguesePhrase,
    englishPhrase: c.englishPhrase,
    direction: c.direction || 'pt-en',
    level: c.level ?? 1,
    lastReviewed: c.lastReviewed ? c.lastReviewed.getTime() : null,
    nextReview: c.nextReview.getTime(),
    errorCount: c.errorCount ?? 0,
    imageUrl: c.imageUrl ?? undefined,
    tips: c.tips ?? undefined,
    createdAt: c.createdAt.getTime(),
  };
}

// GET /api/cards?groupId=xxx (opcional)
router.get('/', async (req, res, next) => {
  try {
    const where = { userId: req.user.id };
    if (req.query.groupId) where.groupId = req.query.groupId;
    const list = await prisma.card.findMany({
      where,
      orderBy: { createdAt: 'asc' },
    });
    res.json(list.map(toCardResponse));
  } catch (e) {
    next(e);
  }
});

// POST /api/cards
router.post('/', async (req, res, next) => {
  try {
    const {
      groupId,
      portuguesePhrase,
      englishPhrase,
      direction = 'pt-en',
      imageUrl,
      tips,
    } = req.body;
    if (!groupId || !portuguesePhrase || !englishPhrase) {
      return res.status(400).json({ error: 'groupId, portuguesePhrase e englishPhrase são obrigatórios' });
    }
    const group = await prisma.group.findFirst({
      where: { id: groupId, userId: req.user.id },
    });
    if (!group) return res.status(404).json({ error: 'Grupo não encontrado' });
    // Novos cards ficam disponíveis para revisão imediatamente (nextReview = agora)
    const nextReview = new Date();
    const card = await prisma.card.create({
      data: {
        groupId,
        userId: req.user.id,
        portuguesePhrase: String(portuguesePhrase).trim(),
        englishPhrase: String(englishPhrase).trim(),
        direction: direction === 'en-pt' ? 'en-pt' : 'pt-en',
        level: 1,
        nextReview,
        imageUrl: imageUrl?.trim() || null,
        tips: tips?.trim() || null,
      },
    });
    res.status(201).json(toCardResponse(card));
  } catch (e) {
    next(e);
  }
});

// PATCH /api/cards/:id
router.patch('/:id', async (req, res, next) => {
  try {
    const card = await prisma.card.findFirst({
      where: { id: req.params.id, userId: req.user.id },
    });
    if (!card) return res.status(404).json({ error: 'Card não encontrado' });
    const {
      portuguesePhrase,
      englishPhrase,
      direction,
      imageUrl,
      tips,
      level,
      lastReviewed,
      nextReview,
      errorCount,
    } = req.body;
    const data = {};
    if (portuguesePhrase !== undefined) data.portuguesePhrase = String(portuguesePhrase).trim();
    if (englishPhrase !== undefined) data.englishPhrase = String(englishPhrase).trim();
    if (direction !== undefined) data.direction = direction === 'en-pt' ? 'en-pt' : 'pt-en';
    if (imageUrl !== undefined) data.imageUrl = imageUrl?.trim() || null;
    if (tips !== undefined) data.tips = tips?.trim() || null;
    if (level !== undefined) data.level = Math.max(1, Math.min(5, Number(level) || 1));
    if (lastReviewed !== undefined) data.lastReviewed = lastReviewed ? new Date(lastReviewed) : null;
    if (nextReview !== undefined) data.nextReview = new Date(nextReview);
    if (errorCount !== undefined) data.errorCount = Math.max(0, Number(errorCount) || 0);
    const updated = await prisma.card.update({
      where: { id: req.params.id },
      data,
    });
    res.json(toCardResponse(updated));
  } catch (e) {
    next(e);
  }
});

// DELETE /api/cards/:id
router.delete('/:id', async (req, res, next) => {
  try {
    const card = await prisma.card.findFirst({
      where: { id: req.params.id, userId: req.user.id },
    });
    if (!card) return res.status(404).json({ error: 'Card não encontrado' });
    await prisma.card.delete({ where: { id: req.params.id } });
    res.status(204).send();
  } catch (e) {
    next(e);
  }
});

export default router;
