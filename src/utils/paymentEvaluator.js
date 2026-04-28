/**
 * Função pura que avalia um evento de pagamento e devolve a AÇÃO esperada.
 *
 * Separar decisão de efeito permite:
 *   1. Testar a lógica sem mockar a API do Mercado Pago.
 *   2. Reusar a mesma decisão em diferentes provedores (Stripe segue padrão similar).
 *   3. Auditar o motivo (`reason`) em logs estruturados.
 *
 * Retorno é uma ação tagged-union; o caller orquestra I/O.
 */

import { computeRenewalEndsAt } from './subscriptionDates.js';

/**
 * Status do Mercado Pago que invalidam um pagamento previamente aprovado.
 * - refunded: estorno total
 * - charged_back: chargeback (disputa de cartão vencida)
 * - cancelled: cancelamento (pré ou pós-aprovação)
 *
 * O MP também usa esses status: rejected (falhou antes de aprovar — sem efeito),
 * pending/in_process/authorized (em trânsito — sem efeito).
 */
const INVALIDATING_STATUSES = new Set(['refunded', 'charged_back', 'cancelled']);

/**
 * @typedef {Object} MPPayment
 * @property {string} status                "approved" | "refunded" | ...
 * @property {string} external_reference    "userId:plan" (formato novo) ou "userId" (legado)
 *
 * @typedef {Object} CurrentUser
 * @property {string} id
 * @property {string|null} subscriptionStatus
 * @property {Date|null} subscriptionEndsAt
 * @property {string|null} lastPaymentId
 *
 * @typedef {{ kind: 'activate', userId: string, plan: 'monthly'|'annual', endsAt: Date, paymentId: string }
 *   | { kind: 'downgrade', userId: string, paymentId: string, reason: string }
 *   | { kind: 'noop', reason: string }} PaymentAction
 */

/** Decodifica external_reference "userId:plan". Default: monthly. */
export function parseExternalRef(ref) {
  if (!ref) return null;
  const [userId, plan] = String(ref).split(':');
  if (!userId) return null;
  const safePlan = plan === 'annual' ? 'annual' : 'monthly';
  return { userId, plan: safePlan };
}

/**
 * Avalia o efeito de um evento MP sobre o estado atual do user.
 *
 * Decide:
 *   - approved + idempotência:        activate (renovação cumulativa)
 *   - approved + paymentId já visto:  noop (idempotente)
 *   - refunded/charged_back/cancelled: downgrade IFF este é o lastPaymentId do user
 *   - refunded/etc + outro pagamento já registrado depois: noop (user tem premium de outro pgto)
 *   - rejected/pending/etc:           noop
 *
 * @param {{ payment: MPPayment, user: CurrentUser, paymentId: string, now?: Date }} args
 * @returns {PaymentAction}
 */
export function evaluateMercadoPagoEvent({ payment, user, paymentId, now = new Date() }) {
  const status = payment?.status;
  if (!paymentId) return { kind: 'noop', reason: 'missing_payment_id' };
  if (!user) return { kind: 'noop', reason: 'user_not_found' };

  const parsed = parseExternalRef(payment?.external_reference);
  if (!parsed) return { kind: 'noop', reason: 'bad_external_reference' };
  if (parsed.userId !== user.id) {
    return { kind: 'noop', reason: 'user_mismatch' };
  }

  // ── Pagamento aprovado: ativar (com idempotência) ──────────────────
  if (status === 'approved') {
    if (user.lastPaymentId && user.lastPaymentId === String(paymentId)) {
      return { kind: 'noop', reason: 'already_processed' };
    }
    const endsAt = computeRenewalEndsAt({
      currentEndsAt: user.subscriptionEndsAt,
      plan: parsed.plan,
      now,
    });
    return { kind: 'activate', userId: user.id, plan: parsed.plan, endsAt, paymentId: String(paymentId) };
  }

  // ── Pagamento invalidado: rebaixar SE este é o último processado ──
  if (INVALIDATING_STATUSES.has(status)) {
    // Se o user tem outro pagamento mais recente registrado, este refund/cancel
    // é "histórico" e não deve afetar o premium atual.
    if (user.lastPaymentId && user.lastPaymentId !== String(paymentId)) {
      return { kind: 'noop', reason: 'invalidating_event_for_older_payment' };
    }
    // Caso o user nunca tenha tido lastPaymentId registrado (pagamento pré-deploy)
    // mas esteja active: rebaixamos mesmo assim — cobrimos o caso de chargeback
    // legítimo de pagamento histórico.
    if (user.subscriptionStatus !== 'active' && !user.lastPaymentId) {
      return { kind: 'noop', reason: 'invalidating_event_but_user_not_active' };
    }
    return {
      kind: 'downgrade',
      userId: user.id,
      paymentId: String(paymentId),
      reason: status,
    };
  }

  // ── Demais status (pending, in_process, authorized, rejected, …) ──
  return { kind: 'noop', reason: `non_terminal_status:${status}` };
}
