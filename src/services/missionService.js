/**
 * Missões diárias — geração lazy, progresso atômico, recompensa idempotente.
 *
 * Decisões:
 * - Geração lazy: missões geradas no primeiro GET do dia. Sem cron, sem job.
 *   Custo zero de infra.
 * - Adaptativo: review_cards usa target proporcional ao volume médio do user.
 * - Categorias: 1 core (review_cards), 1 mode (Bricks/Memory/Reader), 1 wild.
 * - rewardedAt separa "completou" de "XP creditado" pra evitar dupla creditação
 *   em caso de retry.
 */

import prisma from '../db.js';
import {
  MISSION_TEMPLATES,
  TEMPLATES_BY_TYPE,
  MISSIONS_PER_DAY,
} from '../constants/missions.js';
import { todayLocal } from './timeService.js';
import { awardXp } from './xpService.js';

/**
 * Retorna missões do dia. Gera se ainda não existem.
 */
export async function getOrGenerateForToday(userId, timezone) {
  const today = todayLocal(timezone);
  const existing = await prisma.dailyMission.findMany({
    where: { userId, date: today },
    orderBy: { createdAt: 'asc' },
  });
  if (existing.length >= MISSIONS_PER_DAY) return existing;

  // Geração: chama mas tolera duplicate por @@unique.
  await generateForDate(userId, today);

  return prisma.dailyMission.findMany({
    where: { userId, date: today },
    orderBy: { createdAt: 'asc' },
  });
}

async function generateForDate(userId, date) {
  const stats = await getUserStats(userId);
  const eligible = Object.values(MISSION_TEMPLATES).filter((t) => t.eligible(stats));
  const picks = pickMissions(eligible, stats);

  // Cria em paralelo, ignora P2002 (unique violation = já existe)
  await Promise.all(
    picks.map((pick) =>
      prisma.dailyMission
        .create({
          data: {
            userId,
            date,
            type: pick.type,
            target: pick.target,
            xpReward: pick.xpReward,
          },
        })
        .catch((e) => {
          if (e?.code === 'P2002') return null; // dup ok
          throw e;
        })
    )
  );
}

/**
 * Algoritmo de seleção: 1 core, 1 mode (se existir), 1 wild diferente.
 */
function pickMissions(eligible, stats) {
  const byCategory = (cat) => eligible.filter((t) => t.category === cat);

  const picks = [];

  // 1. Sempre 1 core (review_cards) com target adaptativo.
  picks.push(scaleTarget(MISSION_TEMPLATES.REVIEW_CARDS, stats));

  // 2. 1 mode (Bricks/Memory/Reader) — só se user já usou alguma modalidade.
  const modeOptions = byCategory('mode');
  if (modeOptions.length > 0) {
    const pick = modeOptions[Math.floor(Math.random() * modeOptions.length)];
    picks.push(scaleTarget(pick, stats));
  }

  // 3. 1 wild — exclui types já escolhidos.
  const usedTypes = new Set(picks.map((p) => p.type));
  const wildOptions = byCategory('wild').filter((t) => !usedTypes.has(t.type));
  if (wildOptions.length > 0) {
    const pick = wildOptions[Math.floor(Math.random() * wildOptions.length)];
    picks.push(scaleTarget(pick, stats));
  }

  // Garante MISSIONS_PER_DAY
  while (picks.length < MISSIONS_PER_DAY) {
    const fallback = eligible.find((t) => !usedTypes.has(t.type));
    if (!fallback) break;
    usedTypes.add(fallback.type);
    picks.push(scaleTarget(fallback, stats));
  }

  return picks.slice(0, MISSIONS_PER_DAY);
}

function scaleTarget(template, stats) {
  let target;
  if (template.type === 'review_cards') {
    // Adaptativo: 1.2× a média de cards/dia, dentro do range do template.
    const avg = stats.avgCardsPerDay || 10;
    const proposed = Math.ceil(avg * 1.2);
    const min = template.targets[0];
    const max = template.targets[template.targets.length - 1];
    target = Math.min(max, Math.max(min, proposed));
  } else if (template.type === 'study_minutes') {
    target = template.targets[0]; // sempre o menor (10min) por padrão
  } else {
    target = template.targets[Math.floor(Math.random() * template.targets.length)];
  }
  return { type: template.type, target, xpReward: template.xpReward };
}

/**
 * Stats inferidas pra missões adaptativas. Olha últimos 7 dias.
 */
async function getUserStats(userId) {
  const recent = await prisma.userActivity.findMany({
    where: { userId },
    orderBy: { date: 'desc' },
    take: 7,
  });

  const totalCardsReviewed = recent.reduce((a, r) => a + r.cardsReviewed, 0);
  const denom = recent.length || 1;
  const avgCardsPerDay = Math.max(5, Math.round(totalCardsReviewed / denom));

  const cardsAtLevel4Plus = await prisma.card.count({
    where: { userId, level: { gte: 4 } },
  });

  return {
    avgCardsPerDay,
    bricksUsed: recent.some((r) => r.bricksCompleted > 0),
    memoryUsed: recent.some((r) => r.memoryCompleted > 0),
    readerUsed: recent.some((r) => r.readerChapters > 0),
    cardsAtLevel4Plus,
  };
}

/**
 * Incrementa progresso de UMA missão (por type) do dia atual.
 * Auto-completa quando atinge target. Recompensa XP idempotente.
 *
 * @returns {{ updated, completed, xpResult }}
 */
export async function updateProgress(userId, type, increment, timezone) {
  if (!TEMPLATES_BY_TYPE[type]) return { updated: null, completed: false, xpResult: null };
  if (!increment || increment <= 0) return { updated: null, completed: false, xpResult: null };

  const today = todayLocal(timezone);

  const mission = await prisma.dailyMission.findUnique({
    where: { userId_date_type: { userId, date: today, type } },
  });

  // Sem missão hoje desse tipo (não foi sorteada)
  if (!mission) return { updated: null, completed: false, xpResult: null };

  // Já recompensada — não mexe mais.
  if (mission.rewardedAt) return { updated: mission, completed: true, xpResult: null };

  const newProgress = Math.min(mission.target, mission.progress + increment);
  const justCompleted = newProgress >= mission.target && !mission.completedAt;

  const updated = await prisma.dailyMission.update({
    where: { id: mission.id },
    data: {
      progress: newProgress,
      completedAt: justCompleted ? new Date() : mission.completedAt,
    },
  });

  // Recompensa XP idempotente (só se não tem rewardedAt ainda)
  let xpResult = null;
  if (justCompleted) {
    const claimed = await prisma.dailyMission.updateMany({
      where: { id: mission.id, rewardedAt: null },
      data: { rewardedAt: new Date() },
    });
    if (claimed.count > 0) {
      // XP fixo de missão — sem multiplicador (decisão de produto)
      xpResult = await awardXp(userId, mission.xpReward, { applyMultiplier: false });
    }
  }

  return { updated, completed: justCompleted, xpResult };
}

/**
 * Reset de "correct_streak" quando user erra um card.
 * Chamado pelos hooks de review.
 */
export async function resetCorrectStreak(userId, timezone) {
  const today = todayLocal(timezone);
  await prisma.dailyMission.updateMany({
    where: {
      userId,
      date: today,
      type: 'correct_streak',
      completedAt: null,
    },
    data: { progress: 0 },
  });
}
