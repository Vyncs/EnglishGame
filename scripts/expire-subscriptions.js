/**
 * Rebaixa para FREE todos os users com subscriptionEndsAt vencido.
 *
 * Uso (manual ou via cron externo):
 *   node scripts/expire-subscriptions.js
 *
 * Saída: lista de users afetados + contagem. Sai com código 0 mesmo se ninguém foi rebaixado.
 *
 * Para uso via HTTP, ver POST /api/admin/jobs/expire-subscriptions
 * (mesma lógica, autenticada via header x-jobs-secret).
 */
import 'dotenv/config';
import prisma from '../src/db.js';
import { expireSubscriptions } from '../src/services/subscriptionService.js';

async function main() {
  const result = await expireSubscriptions();
  console.log(`\n[expire-subscriptions] scan: ${result.scannedAt}`);
  console.log(`[expire-subscriptions] users expirados: ${result.expiredCount}\n`);
  for (const u of result.expired) {
    console.log(`  - ${u.email.padEnd(38)} endsAt=${u.endsAt?.toISOString() ?? '—'}`);
  }
  console.log('');
}

main()
  .then(() => prisma.$disconnect())
  .catch((e) => {
    console.error('[expire-subscriptions] erro:', e);
    prisma.$disconnect();
    process.exit(1);
  });
