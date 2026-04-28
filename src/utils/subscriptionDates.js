/**
 * Funções puras de cálculo de datas de assinatura.
 *
 * Mantidas isoladas em utils/ por dois motivos:
 *   1. Testabilidade (sem I/O, sem Prisma) — smoke tests cobrem aqui.
 *   2. Reuso entre o webhook MP/Stripe e o script de backfill.
 *
 * Convenção: TODAS as datas em UTC (Date object). Caller decide TZ de exibição.
 */

/** Soma `days` ao `date` em UTC e retorna um novo Date. */
export function addDays(date, days) {
  const d = new Date(date);
  d.setUTCDate(d.getUTCDate() + days);
  return d;
}

/**
 * Calcula a `subscriptionEndsAt` para um user já premium que NÃO tem data
 * (caso histórico que motivou o backfill).
 *
 * Regra: o resultado nunca pode estar no passado nem mais perto do que
 * `now + minimumDays`. Evita que o cron de expire-subscriptions rebaixe
 * usuários pagantes na primeira execução após o deploy.
 *
 * Exemplos com minimumDays=30:
 *   - updatedAt = hoje-200d  → endsAt = hoje+30d   (clamp pelo mínimo)
 *   - updatedAt = hoje-10d   → endsAt = hoje+30d   (clamp pelo mínimo)
 *   - updatedAt = hoje+5d    → endsAt = hoje+30d   (updatedAt no futuro: ignorado)
 *   - updatedAt = null/und   → endsAt = hoje+30d   (sem base: usa now)
 *
 * @param {{ updatedAt?: Date | null, now?: Date, minimumDays?: number }} params
 * @returns {Date} a data calculada
 */
export function computeBackfillEndsAt({ updatedAt, now = new Date(), minimumDays = 30 } = {}) {
  const base = updatedAt instanceof Date && updatedAt < now ? updatedAt : now;
  const fromBase = addDays(base, minimumDays);
  const minimumFloor = addDays(now, minimumDays);
  // Sempre o MAIOR entre (base + dias) e (now + dias).
  // Garante que ninguém é rebaixado imediatamente após o backfill.
  return fromBase > minimumFloor ? fromBase : minimumFloor;
}

/**
 * Calcula a próxima `subscriptionEndsAt` para um pagamento aprovado (renovação cumulativa).
 *
 * Regra: se o usuário ainda tem assinatura ativa no futuro, soma os dias do plano
 * a partir do fim atual (cumulativo, sem perder dias pagos). Caso contrário, soma
 * a partir de agora.
 *
 * @param {{ currentEndsAt?: Date | null, plan: 'monthly' | 'annual', now?: Date }} params
 * @returns {Date}
 */
export const PLAN_DURATION_DAYS = { monthly: 30, annual: 365 };

export function computeRenewalEndsAt({ currentEndsAt, plan, now = new Date() } = {}) {
  const days = PLAN_DURATION_DAYS[plan] ?? PLAN_DURATION_DAYS.monthly;
  const base = currentEndsAt instanceof Date && currentEndsAt > now ? currentEndsAt : now;
  return addDays(base, days);
}
