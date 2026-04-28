/**
 * Curva de level e ranks.
 *
 * Curva: XP_PARA_INICIO_NIVEL_N = floor(100 * (N-1)^1.5)
 *
 * Tempo estimado para chegar a cada faixa (10 cards corretos/dia = 50 XP/dia
 * sem multiplicador):
 *   Aprendiz   (1-9)    →  ~2 dias para nivel 2, ~3 sem para nivel 5
 *   Explorador (10-24)  →  ~10 sem
 *   Comunicador(25-49)  →  ~6-8 meses
 *   Fluente    (50-99)  →  ~1-2 anos
 *   Mestre     (100+)   →  anos
 *
 * Curva é exponencial agressiva no começo (entrega cedo a sensação de subir)
 * e séria no fim (alto nível = prestígio real).
 */

/**
 * 5 ranks em PT-BR. Decisão de produto: PT > EN para conexão emocional
 * com o aluno brasileiro.
 */
export const RANKS = [
  { from: 1,   to: 9,         key: 'aprendiz',    name: 'Aprendiz',    cefr: 'A1-A2' },
  { from: 10,  to: 24,        key: 'explorador',  name: 'Explorador',  cefr: 'A2-B1' },
  { from: 25,  to: 49,        key: 'comunicador', name: 'Comunicador', cefr: 'B1-B2' },
  { from: 50,  to: 99,        key: 'fluente',     name: 'Fluente',     cefr: 'B2-C1' },
  { from: 100, to: Infinity,  key: 'mestre',      name: 'Mestre',      cefr: 'C2' },
];

/**
 * XP necessário para *alcançar o início* do level N (cumulativo).
 * Level 1 = 0 XP. Level 2 começa em 100 XP. Etc.
 */
export function xpForLevel(level) {
  if (level <= 1) return 0;
  return Math.floor(100 * Math.pow(level - 1, 1.5));
}

/**
 * Dado um total de XP, retorna o level atual.
 * Usa busca incremental (rápido até level ~200; suficiente).
 */
export function levelForXp(xp) {
  if (xp < 0) return 1;
  let level = 1;
  while (xpForLevel(level + 1) <= xp) {
    level++;
    if (level > 999) break; // safety
  }
  return level;
}

/**
 * Retorna o rank de um level. Garantido a sempre retornar (Mestre absorve infinito).
 */
export function getRank(level) {
  return RANKS.find((r) => level >= r.from && level <= r.to) ?? RANKS[RANKS.length - 1];
}

/**
 * Resumo completo de progresso em um nível.
 */
export function describeProgress(totalXp) {
  const currentLevel = levelForXp(totalXp);
  const xpForCurrent = xpForLevel(currentLevel);
  const xpForNext = xpForLevel(currentLevel + 1);
  const xpInLevel = totalXp - xpForCurrent;
  const xpNeededInLevel = xpForNext - xpForCurrent;
  const xpToNext = xpForNext - totalXp;
  const rank = getRank(currentLevel);

  return {
    totalXp,
    currentLevel,
    rank: { key: rank.key, name: rank.name, cefr: rank.cefr },
    xpForCurrent,
    xpForNext,
    xpInLevel,
    xpNeededInLevel,
    xpToNext,
    progressPct: xpNeededInLevel > 0 ? Math.round((xpInLevel / xpNeededInLevel) * 100) : 0,
  };
}
