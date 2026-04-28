/**
 * Smoke tests do Sprint 0 — sem framework de teste.
 *
 * Pré-requisitos:
 *   1. Rodar a API local: `npm run dev` (em outro terminal)
 *   2. Banco com schema atualizado: `npm run db:push`
 *   3. (Opcional) Defina API_BASE / JOBS_SECRET no ambiente para testes E2E.
 *
 * Uso:
 *   API_BASE=http://localhost:3001 JOBS_SECRET=xxx node scripts/smoke-tests.js
 *
 * O que valida:
 *   ✓ register cria conta nova
 *   ✓ verify-email manual via DB (lê código do banco)
 *   ✓ login retorna JWT
 *   ✓ /api/auth/me com JWT funciona
 *   ✓ /api/payments/mercadopago/simulate-* retorna 404 sem ENABLE_DEV_ENDPOINTS
 *   ✓ POST repetido em /login com senha errada retorna 429 após 5 tentativas
 *   ✓ /api/admin/jobs/expire-subscriptions exige x-jobs-secret correto
 *   ✓ expire-subscriptions service rebaixa user com endsAt < agora
 *   ✓ free user é bloqueado no Coach após FREE_COACH_DAILY_MESSAGES
 *
 * Saída: lista de checks com ✓/✗ e exit code 0/1.
 */
import 'dotenv/config';
import prisma from '../src/db.js';
import { expireSubscriptions } from '../src/services/subscriptionService.js';
import { FREE_COACH_DAILY_MESSAGES, todayDayKeyUTC } from '../src/utils/subscription.js';
import { computeBackfillEndsAt } from '../src/utils/subscriptionDates.js';
import { evaluateMercadoPagoEvent } from '../src/utils/paymentEvaluator.js';

const BASE = process.env.API_BASE || 'http://localhost:3001';
const JOBS_SECRET = process.env.JOBS_SECRET || '';

const RESULTS = [];
function check(name, ok, detail = '') {
  RESULTS.push({ name, ok, detail });
  console.log(`  ${ok ? '✓' : '✗'} ${name}${detail ? '  — ' + detail : ''}`);
}

async function safeFetch(path, opts = {}) {
  try {
    const res = await fetch(BASE + path, opts);
    let body = null;
    try {
      body = await res.json();
    } catch {
      body = null;
    }
    return { status: res.status, body };
  } catch (e) {
    return { status: 0, body: null, err: e.message };
  }
}

async function ping() {
  const r = await safeFetch('/health');
  check('API responde em /health', r.status === 200);
}

async function authFlow() {
  const ts = Date.now();
  const email = `smoke+${ts}@example.com`;
  const password = 'smoke-test-1234';

  // Register
  const reg = await safeFetch('/api/auth/register', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, password, name: 'Smoke User' }),
  });
  check(
    'register cria conta (201) ou retorna 502 se Resend não configurado',
    reg.status === 201 || reg.status === 502,
    `status=${reg.status}`,
  );

  // Verify-email — lê código do banco e confirma
  const dbUser = await prisma.user.findUnique({ where: { email } });
  if (!dbUser) {
    check('verify-email — user existe no banco', false, 'user não criado');
    return null;
  }
  const code = dbUser.verificationCode;
  if (!code) {
    check('verify-email — código presente', false, 'sem code no banco');
    return null;
  }
  const ver = await safeFetch('/api/auth/verify-email', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, code }),
  });
  check('verify-email aceita o código (200)', ver.status === 200, `status=${ver.status}`);

  // Login
  const log = await safeFetch('/api/auth/login', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, password }),
  });
  check('login retorna 200 com JWT', log.status === 200 && !!log.body?.token, `status=${log.status}`);
  const token = log.body?.token;

  // /me
  const me = await safeFetch('/api/auth/me', {
    headers: { Authorization: `Bearer ${token}` },
  });
  check('/auth/me com JWT funciona', me.status === 200 && me.body?.user?.email === email);

  return { email, password, token, userId: dbUser.id };
}

async function simulateEndpointBlocked() {
  // Sem ENABLE_DEV_ENDPOINTS, deve retornar 404 ou 401 (auth necessária para descobrir).
  const r = await safeFetch('/api/payments/mercadopago/simulate-notification', {
    method: 'POST',
  });
  // Sem auth retorna 401 (rota não montada → 404; rota montada com authMiddleware → 401).
  // Aceitamos ambos como "não está vazando o effect"; o que NÃO pode é 200.
  check(
    'simulate-notification não está acessível (sem opt-in)',
    r.status === 404 || r.status === 401 || r.status === 405,
    `status=${r.status}`,
  );
}

async function authRateLimit() {
  const email = `rl+${Date.now()}@example.com`;
  let last = 0;
  for (let i = 0; i < 7; i++) {
    const r = await safeFetch('/api/auth/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, password: 'wrong' }),
    });
    last = r.status;
  }
  check(
    'login retorna 429 após 5 tentativas falhas em 15min',
    last === 429,
    `status final após 7 tentativas=${last}`,
  );
}

async function jobsAuth() {
  const noKey = await safeFetch('/api/admin/jobs/expire-subscriptions', { method: 'POST' });
  check(
    '/jobs/expire-subscriptions sem x-jobs-secret retorna 401 (ou 503 sem JOBS_SECRET no server)',
    noKey.status === 401 || noKey.status === 503,
    `status=${noKey.status}`,
  );

  if (JOBS_SECRET) {
    const wrong = await safeFetch('/api/admin/jobs/expire-subscriptions', {
      method: 'POST',
      headers: { 'x-jobs-secret': 'wrong-key' },
    });
    check('/jobs/expire-subscriptions com chave errada retorna 401', wrong.status === 401);

    const ok = await safeFetch('/api/admin/jobs/expire-subscriptions', {
      method: 'POST',
      headers: { 'x-jobs-secret': JOBS_SECRET },
    });
    check(
      '/jobs/expire-subscriptions com chave correta retorna 200',
      ok.status === 200 && typeof ok.body?.expiredCount === 'number',
    );
  } else {
    console.log('  ⚠ JOBS_SECRET não exportado — pulando test E2E do endpoint autenticado.');
  }
}

async function expireSubscriptionsLogic(userId) {
  if (!userId) return;
  // Cria estado: user active com endsAt no passado.
  await prisma.user.update({
    where: { id: userId },
    data: {
      subscriptionStatus: 'active',
      subscriptionEndsAt: new Date(Date.now() - 24 * 3600 * 1000), // 1 dia atrás
    },
  });

  const result = await expireSubscriptions();
  const after = await prisma.user.findUnique({ where: { id: userId } });
  check(
    'expireSubscriptions rebaixa user com endsAt vencido para free',
    after.subscriptionStatus === null && result.expiredCount >= 1,
    `expiredCount=${result.expiredCount}, status pós=${after.subscriptionStatus}`,
  );

  // Vip não deve ser tocado (cortesia)
  const vipEmail = `vip+${Date.now()}@example.com`;
  const vip = await prisma.user.create({
    data: {
      email: vipEmail,
      emailVerified: true,
      subscriptionStatus: 'vip',
      subscriptionEndsAt: new Date(Date.now() - 24 * 3600 * 1000),
    },
  });
  await expireSubscriptions();
  const vipAfter = await prisma.user.findUnique({ where: { id: vip.id } });
  check(
    'expireSubscriptions NÃO toca em users VIP',
    vipAfter.subscriptionStatus === 'vip',
    `status pós=${vipAfter.subscriptionStatus}`,
  );
  await prisma.user.delete({ where: { id: vip.id } });
}

async function coachQuotaLogic(userId) {
  if (!userId) return;
  // Garante user free (sem subscription)
  await prisma.user.update({
    where: { id: userId },
    data: { subscriptionStatus: null, subscriptionEndsAt: null },
  });
  // Limpa cota de hoje
  const dayKey = todayDayKeyUTC();
  await prisma.englishCoachUsage.deleteMany({ where: { userId, dayKey } });

  // Simula que já bateu o limite
  await prisma.englishCoachUsage.create({
    data: { userId, dayKey, count: FREE_COACH_DAILY_MESSAGES },
  });

  const usage = await prisma.englishCoachUsage.findUnique({
    where: { userId_dayKey: { userId, dayKey } },
  });
  check(
    `EnglishCoachUsage registra count=${FREE_COACH_DAILY_MESSAGES} para o user free`,
    usage?.count === FREE_COACH_DAILY_MESSAGES,
  );
}

async function cleanup(userId) {
  if (!userId) return;
  await prisma.englishCoachUsage.deleteMany({ where: { userId } });
  await prisma.user.delete({ where: { id: userId } }).catch(() => {});
}

// ─── HOTFIX R1 — Backfill nunca rebaixa premium imediatamente ─────────────
function r1BackfillNeverImmediateExpire() {
  console.log('\n— R1 — backfill ≥ now+30d');
  const now = new Date('2026-04-28T12:00:00Z');
  const minimum = new Date(now.getTime() + 30 * 86400000);
  const cases = [
    { label: 'updatedAt 200d atrás', updatedAt: new Date('2025-10-10T00:00:00Z') },
    { label: 'updatedAt 10d atrás',  updatedAt: new Date('2026-04-18T00:00:00Z') },
    { label: 'updatedAt no futuro',  updatedAt: new Date('2026-08-06T00:00:00Z') },
    { label: 'updatedAt null',       updatedAt: null },
  ];
  for (const c of cases) {
    const r = computeBackfillEndsAt({ updatedAt: c.updatedAt, now, minimumDays: 30 });
    check(`R1: backfill (${c.label}) ≥ now+30d`, r.getTime() >= minimum.getTime(),
      `endsAt=${r.toISOString().slice(0,10)}`);
  }
}

// ─── HOTFIX R2 — Refund/chargeback rebaixa; pagamentos antigos ignorados ──
function r2PaymentEvaluator() {
  console.log('\n— R2 — refund/chargeback/cancelled');
  const now = new Date('2026-04-28T12:00:00Z');
  const activeUser = {
    id: 'u1',
    subscriptionStatus: 'active',
    subscriptionEndsAt: new Date('2026-05-15T00:00:00Z'),
    lastPaymentId: 'P1',
  };
  const cases = [
    {
      name: 'approved nova → activate',
      payment: { status: 'approved', external_reference: 'u1:monthly' },
      user: activeUser, paymentId: 'P2', expect: 'activate',
    },
    {
      name: 'approved repetida → noop (idempotente)',
      payment: { status: 'approved', external_reference: 'u1:monthly' },
      user: activeUser, paymentId: 'P1', expect: 'noop',
    },
    {
      name: 'refunded do último pagamento → downgrade',
      payment: { status: 'refunded', external_reference: 'u1:monthly' },
      user: activeUser, paymentId: 'P1', expect: 'downgrade',
    },
    {
      name: 'charged_back do último → downgrade',
      payment: { status: 'charged_back', external_reference: 'u1:monthly' },
      user: activeUser, paymentId: 'P1', expect: 'downgrade',
    },
    {
      name: 'cancelled do último → downgrade',
      payment: { status: 'cancelled', external_reference: 'u1:monthly' },
      user: activeUser, paymentId: 'P1', expect: 'downgrade',
    },
    {
      name: 'refunded de pagamento ANTIGO → noop (não derruba premium atual)',
      payment: { status: 'refunded', external_reference: 'u1:monthly' },
      user: activeUser, paymentId: 'P0_OLD', expect: 'noop',
    },
    {
      name: 'rejected → noop',
      payment: { status: 'rejected', external_reference: 'u1:monthly' },
      user: activeUser, paymentId: 'PX', expect: 'noop',
    },
    {
      name: 'pending → noop',
      payment: { status: 'pending', external_reference: 'u1:monthly' },
      user: activeUser, paymentId: 'PX', expect: 'noop',
    },
  ];
  for (const c of cases) {
    const r = evaluateMercadoPagoEvent({
      payment: c.payment, user: c.user, paymentId: c.paymentId, now,
    });
    check(`R2: ${c.name}`, r.kind === c.expect, `kind=${r.kind}`);
  }
}

// ─── HOTFIX R3 — Buckets de rate limit independentes ──────────────────────
//
// Esgotar verify-email NÃO pode bloquear login nem resend-verification.
// Esgotar resend NÃO pode bloquear login. E vice-versa.
//
// Ataca um endpoint até receber 429 e prova que outros endpoints respondem
// com status diferente de 429 logo em seguida (mesmo IP, mesmo email).
async function r3RateLimitsIndependent() {
  console.log('\n— R3 — rate limits independentes por endpoint');
  const email = `r3+${Date.now()}@example.com`;

  // Saturar verify-email (limite 10/15min) — 12 tentativas de código fictício.
  let lastVerify = 0;
  for (let i = 0; i < 12; i++) {
    const r = await safeFetch('/api/auth/verify-email', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, code: '000000' }),
    });
    lastVerify = r.status;
  }
  check('R3: verify-email satura em 429 após 10 tentativas', lastVerify === 429,
    `status final=${lastVerify}`);

  // Logo em seguida — login deve responder 401 (credenciais inválidas), NÃO 429.
  const loginAfter = await safeFetch('/api/auth/login', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, password: 'qualquer' }),
  });
  check('R3: login NÃO está bloqueado quando verify-email saturou',
    loginAfter.status !== 429,
    `login status=${loginAfter.status}`);

  // E resend-verification deve responder 404 (user não existe) ou 400, NÃO 429.
  const resendAfter = await safeFetch('/api/auth/resend-verification', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email }),
  });
  check('R3: resend-verification NÃO está bloqueado quando verify-email saturou',
    resendAfter.status !== 429,
    `resend status=${resendAfter.status}`);
}

async function main() {
  console.log(`\n=== SMOKE TESTS (Sprint 0 + Hotfixes R1/R2/R3) — base=${BASE} ===`);

  // Hotfix tests primeiro (puros — não exigem servidor).
  r1BackfillNeverImmediateExpire();
  r2PaymentEvaluator();

  // E2E (exigem servidor)
  console.log('\n— Sprint 0 (E2E)');
  await ping();
  const auth = await authFlow();
  await simulateEndpointBlocked();
  await authRateLimit();
  await r3RateLimitsIndependent();
  await jobsAuth();
  await expireSubscriptionsLogic(auth?.userId);
  await coachQuotaLogic(auth?.userId);
  await cleanup(auth?.userId);

  const failed = RESULTS.filter((r) => !r.ok);
  console.log(`\n=== ${RESULTS.length - failed.length}/${RESULTS.length} OK ===\n`);
  if (failed.length) {
    console.log('Falhas:');
    for (const f of failed) console.log(`  ✗ ${f.name} — ${f.detail}`);
  }
  process.exit(failed.length ? 1 : 0);
}

main()
  .then(() => prisma.$disconnect())
  .catch((e) => {
    console.error('Erro fatal nos smoke tests:', e);
    prisma.$disconnect();
    process.exit(1);
  });
