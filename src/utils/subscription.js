/** Assinatura paga ou VIP (cortesia). */
export function isPremiumUser(user) {
  if (!user) return false;
  const s = user.subscriptionStatus;
  return s === 'active' || s === 'vip';
}

export const FREE_MAX_GROUPS = 10;
export const FREE_MAX_CARDS_PER_GROUP = 20;

/**
 * Cota diária de mensagens do English Coach para usuários FREE.
 * Premium ('active' ou 'vip') é ilimitado.
 */
export const FREE_COACH_DAILY_MESSAGES = 5;

/** Chave de dia em UTC (YYYY-MM-DD) usada na tabela EnglishCoachUsage. */
export function todayDayKeyUTC(date = new Date()) {
  return date.toISOString().slice(0, 10);
}
