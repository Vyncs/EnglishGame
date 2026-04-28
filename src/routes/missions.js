/**
 * GET  /api/missions/today  — lista de missões do dia (gera se ausentes)
 * POST /api/missions/progress — incrementa progresso (uso interno do frontend)
 *                               body: { type, increment }
 *
 * O endpoint POST existe pra modos que NÃO passam pela API (ex: Bricks puro
 * frontend). Para review de cards, o backend já incrementa via hook em PATCH.
 */

import { Router } from 'express';
import prisma from '../db.js';
import { authMiddleware } from '../middleware/auth.js';
import { getOrGenerateForToday, updateProgress } from '../services/missionService.js';
import { logActivity } from '../services/streakService.js';
import { getUserTimezone } from '../services/timeService.js';

const router = Router();
router.use(authMiddleware);

router.get('/today', async (req, res, next) => {
  try {
    const tz = await resolveTimezone(req.user.id);
    const missions = await getOrGenerateForToday(req.user.id, tz);
    res.json(missions.map(toMissionResponse));
  } catch (e) {
    next(e);
  }
});

/**
 * Body:
 *   { type: 'complete_bricks' | 'complete_memory' | 'read_chapter' | 'study_minutes' | 'create_cards', increment: number }
 *
 * Tipos via review (review_cards, correct_streak, master_card) são incrementados
 * pelo PATCH /api/cards e NÃO devem ser chamados aqui (evita dupla contagem).
 */
const FRONTEND_ALLOWED_TYPES = new Set([
  'complete_bricks',
  'complete_memory',
  'read_chapter',
  'study_minutes',
  'create_cards',
]);

router.post('/progress', async (req, res, next) => {
  try {
    const { type, increment = 1 } = req.body || {};
    if (!FRONTEND_ALLOWED_TYPES.has(type)) {
      return res.status(400).json({ error: 'Tipo de missão inválido para esta rota' });
    }
    const inc = Math.max(1, Math.min(60, Number(increment) || 1));
    const tz = await resolveTimezone(req.user.id);

    // Loga atividade no contador do dia (mantém streak)
    const activityDelta = mapTypeToActivityDelta(type, inc);
    if (activityDelta) {
      await logActivity(req.user.id, activityDelta, tz);
    }

    const result = await updateProgress(req.user.id, type, inc, tz);
    res.json({
      mission: result.updated ? toMissionResponse(result.updated) : null,
      completed: result.completed,
      xp: result.xpResult || null,
    });
  } catch (e) {
    next(e);
  }
});

function mapTypeToActivityDelta(type, increment) {
  switch (type) {
    case 'complete_bricks':
      return { bricksCompleted: increment };
    case 'complete_memory':
      return { memoryCompleted: increment };
    case 'read_chapter':
      return { readerChapters: increment };
    case 'study_minutes':
      return { studyMinutes: increment };
    case 'create_cards':
      return null; // não conta como "estudo"
    default:
      return null;
  }
}

async function resolveTimezone(userId) {
  const prefs = await prisma.userPreferences.findUnique({
    where: { userId },
    select: { timezone: true },
  });
  return getUserTimezone({ preferences: prefs });
}

function toMissionResponse(m) {
  return {
    id: m.id,
    type: m.type,
    target: m.target,
    progress: m.progress,
    xpReward: m.xpReward,
    completedAt: m.completedAt ? m.completedAt.toISOString() : null,
    rewardedAt: m.rewardedAt ? m.rewardedAt.toISOString() : null,
    date: m.date,
  };
}

export default router;
