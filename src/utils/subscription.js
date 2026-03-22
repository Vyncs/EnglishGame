/** Assinatura paga ou VIP (cortesia). */
export function isPremiumUser(user) {
  if (!user) return false;
  const s = user.subscriptionStatus;
  return s === 'active' || s === 'vip';
}

export const FREE_MAX_GROUPS = 10;
export const FREE_MAX_CARDS_PER_GROUP = 20;
