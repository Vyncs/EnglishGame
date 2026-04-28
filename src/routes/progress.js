/**
 * GET /api/progress — payload único pra hidratar a Home.
 *
 * Inclui:
 * - XP / level / rank / progresso no nível
 * - Streak (current, best, status, weekActivity)
 * - Missões de hoje (gera se ainda não existem)
 * - Urgência (cards vencendo hoje + críticos)
 *
 * Otimização: tudo em paralelo. Latência típica < 50ms.
 */

import { Router } from 'express';
import prisma from '../db.js';
import { authMiddleware } from '../middleware/auth.js';
import { getProgressSnapshot } from '../services/xpService.js';
import { getStreakStatus, getWeekActivity } from '../services/streakService.js';
import { getOrGenerateForToday } from '../services/missionService.js';
import { getUserTimezone } from '../services/timeService.js';

const router = Router();
router.use(authMiddleware);

router.get('/', async (req, res, next) => {
  try {
    const userId = req.user.id;

    // Resolve timezone do user (uma query a parte é mais barato que include nas próximas)
    const prefs = await prisma.userPreferences.findUnique({
      where: { userId },
      select: { timezone: true },
    });
    const timezone = getUserTimezone({ preferences: prefs });

    const [snapshot, streak, weekActivity, missions, urgency] = await Promise.all([
      getProgressSnapshot(userId),
      getStreakStatus(userId, timezone),
      getWeekActivity(userId, timezone),
      getOrGenerateForToday(userId, timezone),
      computeUrgency(userId),
    ]);

    res.json({
      // XP / Level / Rank
      totalXp: snapshot.snapshot.totalXp,
      currentLevel: snapshot.snapshot.currentLevel,
      rank: snapshot.snapshot.rank,
      xpForCurrent: snapshot.snapshot.xpForCurrent,
      xpForNext: snapshot.snapshot.xpForNext,
      xpInLevel: snapshot.snapshot.xpInLevel,
      xpNeededInLevel: snapshot.snapshot.xpNeededInLevel,
      xpToNext: snapshot.snapshot.xpToNext,
      progressPct: snapshot.snapshot.progressPct,

      // Streak
      streak: {
        current: streak.effectiveStreak,
        rawCurrent: streak.progress.currentStreak, // último valor bruto, mesmo se broken
        best: streak.progress.bestStreak,
        status: streak.status, // 'active' | 'at_risk' | 'broken' | 'none'
        lastActiveDate: streak.progress.lastActiveDate,
        weekActivity, // boolean[7], cronológico (6 dias atrás → hoje)
        lateInDay: streak.lateInDay,
        freezesAvailable: streak.progress.freezesAvailable,
      },

      // Missões de hoje
      missions: missions.map(toMissionResponse),

      // Urgência (derivado dos cards)
      urgency,

      // Lifetime
      stats: {
        totalActiveDays: streak.progress.totalActiveDays,
        totalCardsReviewed: streak.progress.totalCardsReviewed,
      },

      timezone,
    });
  } catch (e) {
    next(e);
  }
});

async function computeUrgency(userId) {
  const now = new Date();
  const endOfToday = new Date(now);
  endOfToday.setHours(23, 59, 59, 999);

  const threeDaysAgo = new Date(now);
  threeDaysAgo.setDate(threeDaysAgo.getDate() - 3);

  const [dueToday, critical] = await Promise.all([
    prisma.card.count({
      where: { userId, nextReview: { lte: endOfToday } },
    }),
    prisma.card.count({
      where: {
        userId,
        nextReview: { lt: threeDaysAgo },
        errorCount: { gte: 3 },
      },
    }),
  ]);

  return { dueToday, critical };
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
