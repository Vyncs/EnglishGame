/**
 * Sistema de streak — log diário de atividade + recálculo idempotente.
 *
 * Decisões:
 * - Source of truth = UserActivity (uma row por dia ativo).
 * - UserProgress.currentStreak/bestStreak são DENORMALIZADOS pra leitura
 *   rápida na home; recalculados a cada vez que um dia "passa o threshold".
 * - 5 reviews mínimos pra contar dia ativo (anti-streak-fake).
 * - Idempotente: chamar logActivity 100x no mesmo dia incrementa contadores
 *   mas só atualiza streak na primeira vez que o dia "passa".
 */

import prisma from '../db.js';
import { todayLocal, daysBetween, lastNDates, localHour } from './timeService.js';
import { STREAK_MIN_REVIEWS } from '../constants/missions.js';
import { getOrCreateProgress } from './xpService.js';

/**
 * Incrementa contadores de atividade do dia, e atualiza streak quando
 * o dia atravessa o threshold.
 *
 * @param {string} userId
 * @param {object} delta - { cardsReviewed?, cardsCorrect?, bricksCompleted?, ... }
 * @param {string} timezone - IANA tz do user
 * @returns {{ activity, streakChanged, oldStreak?, newStreak?, isNewRecord? }}
 */
export async function logActivity(userId, delta = {}, timezone) {
  const today = todayLocal(timezone);

  // Sanitiza delta (só campos conhecidos, valores >= 0)
  const safeDelta = sanitizeDelta(delta);

  // Upsert UserActivity (incrementa atomicamente)
  const activity = await prisma.userActivity.upsert({
    where: { userId_date: { userId, date: today } },
    create: { userId, date: today, ...safeDelta },
    update: Object.fromEntries(
      Object.entries(safeDelta).map(([k, v]) => [k, { increment: v }])
    ),
  });

  // Já contado como dia ativo? Não mexe em streak.
  if (activity.countedAsActive) {
    return { activity, streakChanged: false };
  }

  // Verifica se passou o threshold neste log
  const passedThreshold =
    activity.cardsReviewed >= STREAK_MIN_REVIEWS ||
    activity.bricksCompleted >= 1 ||
    activity.memoryCompleted >= 1 ||
    activity.readerChapters >= 1;

  if (!passedThreshold) {
    return { activity, streakChanged: false };
  }

  // Marca dia como ativo (idempotente — usa where countedAsActive: false)
  const marked = await prisma.userActivity.updateMany({
    where: { id: activity.id, countedAsActive: false },
    data: { countedAsActive: true },
  });

  if (marked.count === 0) {
    // Outra request ganhou a corrida — já marcado, não duplica streak.
    return { activity, streakChanged: false };
  }

  // Recalcula streak no UserProgress
  return await updateStreakAfterActiveDay(userId, today);
}

async function updateStreakAfterActiveDay(userId, today) {
  const progress = await getOrCreateProgress(userId);
  const lastDate = progress.lastActiveDate;

  let newStreak = 1;
  if (lastDate) {
    const diff = daysBetween(lastDate, today);
    if (diff === 0) {
      // Já contado hoje — nada a fazer.
      return { streakChanged: false };
    }
    if (diff === 1) {
      newStreak = progress.currentStreak + 1;
    } else if (diff > 1) {
      // Quebrou — reinicia em 1.
      newStreak = 1;
    }
  }

  const isNewRecord = newStreak > progress.bestStreak;
  const newBest = Math.max(progress.bestStreak, newStreak);

  const updated = await prisma.userProgress.update({
    where: { userId },
    data: {
      currentStreak: newStreak,
      bestStreak: newBest,
      lastActiveDate: today,
      totalActiveDays: { increment: 1 },
    },
  });

  return {
    streakChanged: true,
    oldStreak: progress.currentStreak,
    newStreak: updated.currentStreak,
    bestStreak: updated.bestStreak,
    isNewRecord,
  };
}

/**
 * Resolve estado do streak (active | at_risk | broken | none) sem mutar.
 *
 *   active   = atividade hoje, streak conta normalmente
 *   at_risk  = última atividade foi ontem, ainda dá tempo hoje
 *   broken   = última atividade > 1 dia atrás (streak efetivamente zerado)
 *   none     = nunca teve atividade
 */
export async function getStreakStatus(userId, timezone) {
  const progress = await getOrCreateProgress(userId);
  const today = todayLocal(timezone);

  if (!progress.lastActiveDate) {
    return { progress, status: 'none', effectiveStreak: 0 };
  }

  const diff = daysBetween(progress.lastActiveDate, today);
  let status;
  let effectiveStreak = progress.currentStreak;

  if (diff === 0) {
    status = 'active';
  } else if (diff === 1) {
    // Ontem foi último dia ativo — ainda em risco, mas streak ainda válido
    status = 'at_risk';
    // Se já passou de 18h e ainda não fez nada hoje, o tom muda no frontend
    // (mas dado é o mesmo).
  } else {
    status = 'broken';
    effectiveStreak = 0; // pra exibição
  }

  return { progress, status, effectiveStreak, lateInDay: localHour(timezone) >= 18 };
}

/**
 * Atividade dos últimos 7 dias (boolean[] de dias ativos).
 * Usado pelo mini-calendário da home.
 */
export async function getWeekActivity(userId, timezone) {
  const dates = lastNDates(7, timezone);
  const rows = await prisma.userActivity.findMany({
    where: { userId, date: { in: dates } },
    select: { date: true, countedAsActive: true },
  });
  const activeSet = new Set(rows.filter((r) => r.countedAsActive).map((r) => r.date));
  return dates.map((d) => activeSet.has(d));
}

/**
 * Histórico de N dias com counters detalhados — pra calendário /perfil.
 */
export async function getActivityRange(userId, fromDate, toDate) {
  const where = { userId };
  if (fromDate || toDate) {
    where.date = {};
    if (fromDate) where.date.gte = fromDate;
    if (toDate) where.date.lte = toDate;
  }
  return prisma.userActivity.findMany({
    where,
    orderBy: { date: 'asc' },
    select: {
      date: true,
      cardsReviewed: true,
      cardsCorrect: true,
      bricksCompleted: true,
      memoryCompleted: true,
      readerChapters: true,
      studyMinutes: true,
      xpEarned: true,
      countedAsActive: true,
    },
  });
}

// ----- helpers -----

const ALLOWED_DELTA_KEYS = [
  'cardsReviewed',
  'cardsCorrect',
  'bricksCompleted',
  'memoryCompleted',
  'readerChapters',
  'studyMinutes',
  'xpEarned',
];

function sanitizeDelta(delta) {
  const out = {};
  for (const key of ALLOWED_DELTA_KEYS) {
    const v = delta?.[key];
    if (v == null) continue;
    const n = Number(v);
    if (!Number.isFinite(n) || n < 0) continue;
    out[key] = Math.floor(n);
  }
  return out;
}
