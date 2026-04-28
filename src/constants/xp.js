/**
 * Tabela de XP por ação + multiplicadores de streak.
 *
 * Princípios:
 * - XP "barato" para ações repetitivas (review). Recompensa volume.
 * - Bônus para promoção (card subiu de nível Leitner).
 * - Bônus alto para mastery (chegar em level 5 Leitner = card "dominado").
 * - Multiplicadores de streak premiam consistência, não esforço pontual.
 */

export const XP = {
  /** Card revisado e respondido corretamente. */
  REVIEW_CORRECT: 5,
  /** Bônus extra quando o card SOBE de nível Leitner (1→2, 2→3, etc.). */
  REVIEW_PROMOTED_BONUS: 3,
  /** Bônus quando o card chega ao level 5 (Dominado). Acumula com REVIEW_PROMOTED_BONUS. */
  CARD_MASTERED_BONUS: 50,

  /** Bricks Challenge — frase correta. */
  BRICK_CORRECT: 4,
  /** Bricks Challenge — sessão completa (10 frases). */
  BRICK_SESSION_COMPLETE: 30,

  /** Memory Game — sessão completa. */
  MEMORY_GAME_COMPLETE: 30,

  /** Reader — capítulo completo. */
  READER_CHAPTER_COMPLETE: 25,

  /** Karaokê — música completa. */
  KARAOKE_SONG_COMPLETE: 35,
};

/**
 * Multiplicador aplicado sobre o XP base de qualquer ação,
 * em função do streak atual. Resultado é arredondado.
 *
 * Decisão: o multiplicador SÓ se aplica a ações de estudo direto
 * (review, brick, memory, reader, karaoke). Missões NÃO recebem
 * multiplicador (já têm XP fixo elevado).
 */
export function getStreakMultiplier(currentStreak) {
  if (currentStreak >= 100) return 2.0;
  if (currentStreak >= 30) return 1.5;
  if (currentStreak >= 7) return 1.2;
  return 1.0;
}

/**
 * Aplica multiplicador e arredonda. Helper único pra evitar
 * inconsistência em vários lugares.
 */
export function withMultiplier(baseXp, currentStreak) {
  const m = getStreakMultiplier(currentStreak);
  return {
    baseXp,
    multiplier: m,
    finalXp: Math.round(baseXp * m),
  };
}
