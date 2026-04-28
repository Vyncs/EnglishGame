/**
 * Backfill conservador de subscriptionEndsAt para premiums já existentes.
 *
 * Contexto: até hoje, o webhook do Mercado Pago ativava subscriptionStatus='active'
 * sem nunca setar subscriptionEndsAt. Esses usuários precisam de uma data para
 * que o cron de expire-subscriptions saiba quando rebaixá-los.
 *
 * Estratégia (definida em utils/subscriptionDates.js):
 *   - Resultado é SEMPRE >= now + 30 dias.
 *   - Se updatedAt + 30d for ainda mais no futuro, usa esse valor.
 *   - Garante que ninguém pagante seja rebaixado na primeira execução do cron.
 *
 * Filtros:
 *   - Apenas users com subscriptionStatus = 'active' E subscriptionEndsAt IS NULL.
 *   - NÃO toca em 'vip' (cortesia), 'canceled', 'past_due', NULL (free).
 *   - Idempotente: rodar 2x não muda nada após a 1ª execução.
 *
 * Uso:
 *   node scripts/backfill-subscription-ends.js          # dry-run (lista, não escreve)
 *   node scripts/backfill-subscription-ends.js --apply  # aplica de fato
 */
import 'dotenv/config';
import prisma from '../src/db.js';
import { computeBackfillEndsAt } from '../src/utils/subscriptionDates.js';

const APPLY = process.argv.includes('--apply');
const MINIMUM_DAYS = 30;

async function main() {
  const now = new Date();
  const candidates = await prisma.user.findMany({
    where: {
      subscriptionStatus: 'active',
      subscriptionEndsAt: null,
    },
    select: { id: true, email: true, updatedAt: true },
  });

  console.log(`\n[backfill] Encontrados ${candidates.length} users 'active' sem subscriptionEndsAt.\n`);

  if (candidates.length === 0) {
    console.log('Nada a fazer.');
    return;
  }

  let touched = 0;
  for (const u of candidates) {
    const endsAt = computeBackfillEndsAt({
      updatedAt: u.updatedAt,
      now,
      minimumDays: MINIMUM_DAYS,
    });
    const baseLabel = u.updatedAt ? u.updatedAt.toISOString().slice(0, 10) : 'sem updatedAt';
    console.log(
      `  ${APPLY ? '✓' : '○'} ${u.email.padEnd(38)} → endsAt=${endsAt.toISOString().slice(0, 10)} (base: ${baseLabel})`,
    );
    if (APPLY) {
      await prisma.user.update({
        where: { id: u.id },
        data: { subscriptionEndsAt: endsAt },
      });
      touched++;
    }
  }

  if (APPLY) {
    console.log(`\n[backfill] ${touched} users atualizados (mínimo garantido: now + ${MINIMUM_DAYS} dias).\n`);
  } else {
    console.log(`\n[backfill] DRY-RUN. Nada foi escrito. Rode com --apply para confirmar.\n`);
  }
}

main()
  .then(() => prisma.$disconnect())
  .catch((e) => {
    console.error('[backfill] erro:', e);
    prisma.$disconnect();
    process.exit(1);
  });
