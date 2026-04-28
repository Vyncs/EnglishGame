/**
 * Concessão de XP e cálculo de level.
 *
 * Decisões:
 * - awardXp é a ÚNICA porta de entrada. Caller passa o XP base (ou key da
 *   tabela XP). Service aplica multiplicador de streak conforme regra.
 * - Level é DERIVADO de totalXp na hora da escrita. Não persistimos histórico
 *   de level-ups em V1 (pode ser adicionado via tabela XpEvent depois).
 * - Detecta level up retornando { leveledUp, oldLevel, newLevel } pra que
 *   o caller dispare UX de level-up modal.
 */

import prisma from '../db.js';
import { XP, withMultiplier } from '../constants/xp.js';
import { levelForXp, describeProgress } from '../constants/levels.js';

/**
 * Garante que UserProgress exista. Cria com defaults se primeiro acesso.
 */
export async function getOrCreateProgress(userId) {
  let progress = await prisma.userProgress.findUnique({ where: { userId } });
  if (!progress) {
    progress = await prisma.userProgress.create({ data: { userId } });
  }
  return progress;
}

/**
 * Concede XP a um user.
 *
 * @param {string} userId
 * @param {number} baseXp - XP base (será multiplicado pelo streak)
 * @param {object} [opts]
 * @param {boolean} [opts.applyMultiplier=true] - false para missões (XP fixo)
 * @returns {{ baseXp, multiplier, finalXp, leveledUp, oldLevel, newLevel, totalXp }}
 */
export async function awardXp(userId, baseXp, opts = {}) {
  const { applyMultiplier = true } = opts;
  if (!Number.isFinite(baseXp) || baseXp <= 0) {
    return { baseXp: 0, multiplier: 1, finalXp: 0, leveledUp: false };
  }

  const progress = await getOrCreateProgress(userId);

  const result = applyMultiplier
    ? withMultiplier(baseXp, progress.currentStreak)
    : { baseXp, multiplier: 1, finalXp: Math.round(baseXp) };

  const newTotal = progress.totalXp + result.finalXp;
  const newLevel = levelForXp(newTotal);
  const leveledUp = newLevel > progress.currentLevel;

  const updated = await prisma.userProgress.update({
    where: { userId },
    data: {
      totalXp: newTotal,
      currentLevel: newLevel,
    },
  });

  return {
    ...result,
    leveledUp,
    oldLevel: progress.currentLevel,
    newLevel,
    totalXp: updated.totalXp,
  };
}

/**
 * Helper: concede XP por uma chave da tabela XP. Sintaxe mais expressiva
 * pra callers comuns.
 *
 *   awardXpByAction(userId, 'REVIEW_CORRECT')
 */
export async function awardXpByAction(userId, key, opts) {
  const value = XP[key];
  if (!value) throw new Error(`Unknown XP action: ${key}`);
  return awardXp(userId, value, opts);
}

/**
 * Computa XP de uma revisão de card baseado no estado antes/depois.
 * Retorna 0 se foi resposta errada (não conta XP).
 *
 *   - acerto (level mantém ou sobe): REVIEW_CORRECT
 *   - acerto + promoção (level subiu): + REVIEW_PROMOTED_BONUS
 *   - acerto + acabou de masterizar (level chegou em 5): + CARD_MASTERED_BONUS
 */
export function computeReviewXp({ oldLevel, newLevel, errorCountIncreased }) {
  if (errorCountIncreased) return 0; // resposta errada

  let xp = XP.REVIEW_CORRECT;
  if (newLevel > oldLevel) {
    xp += XP.REVIEW_PROMOTED_BONUS;
    if (newLevel === 5 && oldLevel < 5) {
      xp += XP.CARD_MASTERED_BONUS;
    }
  }
  return xp;
}

/**
 * Resumo de progresso do user (pra endpoint /api/progress).
 */
export async function getProgressSnapshot(userId) {
  const progress = await getOrCreateProgress(userId);
  return {
    progress,
    snapshot: describeProgress(progress.totalXp),
  };
}
