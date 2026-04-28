/**
 * Templates de missões diárias + parâmetros do sistema.
 *
 * Decisões de produto:
 * - 5 reviews mínimos para um dia contar como ativo (anti-streak-fake).
 * - 3 missões/dia. Mais que isso vira to-do list, não vicia.
 * - Missões adaptativas: target escala com volume histórico do user.
 *
 * Decisão de produto: missão NÃO recebe multiplicador de streak.
 * O XP da missão já é o "prêmio" e deve ser previsível.
 */

/** Quantos cards revisados (ou equivalente) contam um dia como ativo. */
export const STREAK_MIN_REVIEWS = 5;

/** Quantas missões geradas por dia. */
export const MISSIONS_PER_DAY = 3;

/**
 * Tipos de missão. Cada um tem:
 * - title:    template com {target}
 * - icon:     nome do ícone Lucide (frontend lê)
 * - targets:  opções de target (target adaptativo escolhe um)
 * - xpReward: XP fixo ao completar
 * - eligible: função(stats) que retorna true se a missão pode ser oferecida
 *
 * stats vem de getUserStats() em missionService.
 */
export const MISSION_TEMPLATES = {
  REVIEW_CARDS: {
    type: 'review_cards',
    title: 'Revisar {target} cards',
    icon: 'BookOpen',
    targets: [10, 15, 20, 30],
    xpReward: 25,
    category: 'core',
    eligible: () => true,
  },
  CORRECT_STREAK: {
    type: 'correct_streak',
    title: 'Acertar {target} cards em sequência',
    icon: 'Zap',
    targets: [3, 5, 7],
    xpReward: 30,
    category: 'wild',
    eligible: () => true,
  },
  COMPLETE_BRICKS: {
    type: 'complete_bricks',
    title: 'Completar {target} sessão de Bricks',
    icon: 'Blocks',
    targets: [1, 2],
    xpReward: 25,
    category: 'mode',
    eligible: (stats) => stats.bricksUsed,
  },
  COMPLETE_MEMORY: {
    type: 'complete_memory',
    title: 'Completar {target} jogo de Memória',
    icon: 'Puzzle',
    targets: [1, 2],
    xpReward: 25,
    category: 'mode',
    eligible: (stats) => stats.memoryUsed,
  },
  READ_CHAPTER: {
    type: 'read_chapter',
    title: 'Ler {target} capítulo de Reader',
    icon: 'BookMarked',
    targets: [1],
    xpReward: 30,
    category: 'mode',
    eligible: (stats) => stats.readerUsed,
  },
  MASTER_CARD: {
    type: 'master_card',
    title: 'Dominar {target} card (chegar ao nível 5)',
    icon: 'Trophy',
    targets: [1, 2],
    xpReward: 40,
    category: 'wild',
    eligible: (stats) => stats.cardsAtLevel4Plus > 0,
  },
  CREATE_CARDS: {
    type: 'create_cards',
    title: 'Criar {target} novos cards',
    icon: 'Plus',
    targets: [3, 5],
    xpReward: 15,
    category: 'wild',
    eligible: () => true,
  },
  STUDY_MINUTES: {
    type: 'study_minutes',
    title: 'Estudar por {target} minutos',
    icon: 'Clock',
    targets: [10, 15],
    xpReward: 25,
    category: 'wild',
    eligible: () => true,
  },
};

/** Templates indexados por tipo (lookup rápido). */
export const TEMPLATES_BY_TYPE = Object.fromEntries(
  Object.values(MISSION_TEMPLATES).map((t) => [t.type, t])
);

/**
 * Resolve título com substituição de {target}.
 */
export function renderTitle(type, target) {
  const tpl = TEMPLATES_BY_TYPE[type];
  if (!tpl) return `Missão (${target})`;
  return tpl.title.replace('{target}', String(target));
}
