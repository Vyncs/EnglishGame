import prisma from '../db.js';

/**
 * Rebaixa para FREE todo usuário cujo subscriptionEndsAt já passou.
 *
 * Regras:
 *   - Toca SOMENTE em users com subscriptionStatus = 'active'.
 *   - NÃO toca em 'vip' (cortesia de professor — sem expiração no MVP).
 *   - NÃO toca em users sem subscriptionEndsAt (pré-backfill).
 *
 * Setamos subscriptionStatus = null (free) e mantemos subscriptionEndsAt
 * histórico para auditoria.
 *
 * @returns {Promise<{ expiredCount: number, scannedAt: string, expired: Array<{id: string, email: string, endsAt: Date | null}> }>}
 */
export async function expireSubscriptions() {
  const now = new Date();

  // Buscar antes para logar quem foi tocado (útil para auditoria).
  const expired = await prisma.user.findMany({
    where: {
      subscriptionStatus: 'active',
      subscriptionEndsAt: { lt: now },
    },
    select: { id: true, email: true, subscriptionEndsAt: true },
  });

  if (expired.length === 0) {
    return { expiredCount: 0, scannedAt: now.toISOString(), expired: [] };
  }

  const ids = expired.map((u) => u.id);
  await prisma.user.updateMany({
    where: { id: { in: ids } },
    data: { subscriptionStatus: null },
  });

  return {
    expiredCount: expired.length,
    scannedAt: now.toISOString(),
    expired: expired.map((u) => ({ id: u.id, email: u.email, endsAt: u.subscriptionEndsAt })),
  };
}
