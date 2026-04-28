import { Router } from 'express';
import prisma from '../db.js';
import { authMiddleware } from '../middleware/auth.js';
import { isPremiumUser, FREE_MAX_CARDS_PER_GROUP } from '../utils/subscription.js';
import { computeReviewXp, awardXp } from '../services/xpService.js';
import { logActivity } from '../services/streakService.js';
import {
  updateProgress as updateMissionProgress,
  resetCorrectStreak,
} from '../services/missionService.js';
import { getUserTimezone } from '../services/timeService.js';

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
    if (!isPremiumUser(req.user)) {
      const inGroup = await prisma.card.count({ where: { userId: req.user.id, groupId } });
      if (inGroup >= FREE_MAX_CARDS_PER_GROUP) {
        return res.status(403).json({
          error: `Plano free: no máximo ${FREE_MAX_CARDS_PER_GROUP} cards por grupo. Assine para adicionar mais.`,
          code: 'FREE_CARD_LIMIT',
        });
      }
    }
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
    // Hook: progresso da missão "create_cards" (best-effort)
    try {
      const user = await prisma.user.findUnique({
        where: { id: req.user.id },
        include: { preferences: { select: { timezone: true } } },
      });
      const tz = getUserTimezone(user);
      await updateMissionProgress(req.user.id, 'create_cards', 1, tz);
    } catch (e) {
      console.error('mission create_cards hook failed:', e);
    }

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

    // ----- Retention hooks (best-effort, não bloqueiam a resposta) -----
    // Detecta se este PATCH foi uma REVISÃO (lastReviewed mudou).
    const isReview = data.lastReviewed !== undefined;
    if (isReview) {
      const oldLevel = card.level ?? 1;
      const newLevel = updated.level ?? 1;
      const errorCountIncreased =
        data.errorCount !== undefined && data.errorCount > (card.errorCount ?? 0);
      const wasCorrect = !errorCountIncreased;

      const xpAmount = computeReviewXp({ oldLevel, newLevel, errorCountIncreased });
      const retentionResult = await runRetentionHooks(req.user.id, {
        wasCorrect,
        promoted: newLevel > oldLevel,
        mastered: newLevel === 5 && oldLevel < 5,
        xpAmount,
      });
      // Inclui resultado de XP/streak/mission no response — frontend usa pra UX.
      return res.json({ ...toCardResponse(updated), retention: retentionResult });
    }

    res.json(toCardResponse(updated));
  } catch (e) {
    next(e);
  }
});

/**
 * Executa hooks de retenção pós-review. Sempre retorna um objeto, mesmo
 * em caso de erro (best-effort — falhas não devem quebrar a review).
 */
async function runRetentionHooks(userId, { wasCorrect, promoted, mastered, xpAmount }) {
  try {
    const user = await prisma.user.findUnique({
      where: { id: userId },
      include: { preferences: { select: { timezone: true } } },
    });
    const tz = getUserTimezone(user);

    // 1. Loga atividade no contador do dia
    await logActivity(
      userId,
      {
        cardsReviewed: 1,
        cardsCorrect: wasCorrect ? 1 : 0,
        xpEarned: xpAmount,
      },
      tz
    );

    // 2. Atualiza progresso de missões aplicáveis
    if (wasCorrect) {
      await updateMissionProgress(userId, 'review_cards', 1, tz);
      await updateMissionProgress(userId, 'correct_streak', 1, tz);
      if (mastered) {
        await updateMissionProgress(userId, 'master_card', 1, tz);
      }
    } else {
      // Errou — zera correct_streak da missão
      await resetCorrectStreak(userId, tz);
    }

    // 3. Awards XP (com multiplicador de streak)
    let xpResult = null;
    if (xpAmount > 0) {
      xpResult = await awardXp(userId, xpAmount);
      // Conta o cardsReviewed lifetime
      await prisma.userProgress.update({
        where: { userId },
        data: { totalCardsReviewed: { increment: 1 } },
      });
    }

    return {
      xp: xpResult,
      promoted,
      mastered,
    };
  } catch (e) {
    console.error('runRetentionHooks failed:', e);
    return { xp: null, error: 'retention_hook_failed' };
  }
}

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
