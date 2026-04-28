# Sprint 0 — Estabilização P0

> Foco exclusivo: **estancar sangrias** (segurança, receita, custos de IA) sem mexer em UI/UX.

## Resumo do que mudou

| # | Categoria | Status |
|---|---|---|
| 1 | `.gitignore` criado, `.env.example` saneado (placeholders apenas) | ✅ |
| 2 | JWT_SECRET hard-fail em produção (sem fallback) | ✅ |
| 3 | Endpoints `/simulate-*` exigem **duplo opt-in** (`NODE_ENV != production` E `ENABLE_DEV_ENDPOINTS=true`) | ✅ |
| 4 | Schema Prisma: `User.lastPaymentId` + modelo `EnglishCoachUsage` | ✅ |
| 5 | Script de backfill `subscriptionEndsAt` para premiums atuais | ✅ |
| 6 | MP grava `subscriptionEndsAt` por plano (mensal/anual) + idempotência | ✅ |
| 7 | Cron de downgrade: script `expire-subscriptions.js` + endpoint HTTP autenticado | ✅ |
| 8 | Cota Coach (5 msg/dia free; ilimitado premium) | ✅ |
| 9 | `express-rate-limit` em `/login`, `/register`, `/verify-email`, `/resend-verification` | ✅ |
| 10 | Smoke tests + esta documentação | ✅ |

## Arquivos modificados

### Backend (`EnglishGame-main/`)

**Criados:**
- `.gitignore`
- `src/utils/env.js` — validação centralizada de env (`getJwtSecret`, `devEndpointsEnabled`)
- `src/middleware/rateLimit.js` — `authLimiter`, `standardLimiter`
- `src/middleware/jobsAuth.js` — header `x-jobs-secret` com `timingSafeEqual`
- `src/services/subscriptionService.js` — `expireSubscriptions()` reutilizável
- `scripts/backfill-subscription-ends.js`
- `scripts/expire-subscriptions.js`
- `scripts/smoke-tests.js`
- `SPRINT-0.md` (este doc)

**Modificados:**
- `.env.example` — saneado, sem segredos reais
- `src/index.js` — boot validation (`getJwtSecret()`) + `app.set('trust proxy', 1)`
- `src/middleware/auth.js` — usa `getJwtSecret()`
- `src/routes/auth.js` — usa `getJwtSecret()` + `authLimiter` em 4 endpoints
- `src/routes/authSocial.js` — usa `getJwtSecret()`
- `src/routes/payments.js` — `external_reference="userId:plan"`, `subscriptionEndsAt` + `lastPaymentId`, `simulate-*` atrás de `devEndpointsEnabled()`
- `src/routes/admin.js` — endpoint `POST /api/admin/jobs/expire-subscriptions` com `jobsAuth`
- `src/routes/englishCoach.js` — gating de cota daily no `/chat`, resposta enriquecida
- `src/utils/subscription.js` — `FREE_COACH_DAILY_MESSAGES = 5`, `todayDayKeyUTC()`
- `prisma/schema.prisma` + `prisma/schema.postgres.prisma` — `User.lastPaymentId`, modelo `EnglishCoachUsage`
- `package.json` — `express-rate-limit`, scripts `job:*` e `smoke`

### Frontend (`GameEnglish-main/`) — apenas typings, **zero UI**

- `src/types/englishCoach.ts` — `CoachChatResponse` ganhou `plan`, `usageLimit`, `usageRemaining` (todos opcionais)
- `src/store/useEnglishCoachStore.ts` — captura `lastUsage: CoachUsageInfo | null`. Sem mudança visual: a UI já trata erros com toast genérico, então o 429 com mensagem "Limite diário atingido…" aparece automaticamente.

## Variáveis de ambiente novas / alteradas

| Var | Valor | Onde setar |
|---|---|---|
| `JWT_SECRET` | mínimo **32 chars** — `openssl rand -base64 32` | `.env` (dev) e Render Dashboard (prod) |
| `JOBS_SECRET` | string forte — `openssl rand -base64 32` | Render Dashboard (prod) e cron externo (header `x-jobs-secret`) |
| `ENABLE_DEV_ENDPOINTS` | `true` apenas em dev quando precisar dos `/simulate-*` | `.env` local; **NÃO definir em produção** |
| `NODE_ENV` | `production` no Render | já configurado em `render.yaml` |

## Como testar localmente

```bash
cd EnglishGame-main

# 1) Atualizar dependências
npm install

# 2) Aplicar schema novo no SQLite local
npm run db:push

# 3) Em terminal separado: subir API
npm run dev

# 4) Em outro terminal: rodar smoke tests
JOBS_SECRET=local-test-secret API_BASE=http://localhost:3001 npm run smoke
```

Resultado esperado: **9/9 OK** (se `JOBS_SECRET` no servidor coincidir com o do shell), ou **8/9 OK** (sem pular o test E2E do endpoint autenticado).

### Casos manuais de teste

```bash
# JWT hard-fail em produção (não suba o servidor sem JWT_SECRET válido)
NODE_ENV=production npm start
# → deve abortar com "JWT_SECRET é obrigatório em produção"

# Backfill: dry-run primeiro
npm run job:backfill-subscription-ends
# → lista candidatos sem escrever
npm run job:backfill-subscription-ends -- --apply
# → aplica de verdade

# Cron de downgrade manual
npm run job:expire-subscriptions
# → lista users com endsAt vencido e rebaixa
```

## Próximos passos manuais (você precisa fazer)

### 🔴 1. Rotacionar credenciais expostas

Os arquivos `.env` e `.env.example` antigos continham segredos reais. Mesmo que o `.env.example` agora esteja limpo, **se isso já foi pra git público, precisa rotacionar tudo**.

**Mercado Pago** — https://www.mercadopago.com.br/developers/panel
- Painel → Suas integrações → Aplicação → Credenciais → "Renovar"
- Atualizar `MERCADOPAGO_ACCESS_TOKEN` no Render

**Supabase** — https://supabase.com/dashboard
- Project Settings → Database → "Reset database password"
- Atualizar `DATABASE_URL` no Render
- Considerar rotacionar Service Role Key também

**Google Cloud (OAuth)** — https://console.cloud.google.com/apis/credentials
- Editar OAuth 2.0 Client ID usado pelo "Sign in with Google"
- "Reset client secret"
- Atualizar `GOOGLE_CLIENT_SECRET` no Render

**Resend** — https://resend.com/api-keys
- Deletar a API key antiga
- Criar nova
- Atualizar `RESEND_API_KEY` no Render

**JWT_SECRET (Render)**
- Gerar novo: `openssl rand -base64 32`
- Setar `JWT_SECRET=...` no Dashboard → Environment
- Isso **força logout global** (todos JWTs antigos invalidados)

**Histórico do git** (se o repo for público)
- `git filter-repo --path EnglishGame-main/.env --invert-paths`
- Depois `git push --force` (cuidado se houver colaboradores)

### 🟠 2. Aplicar schema novo em produção

No Render, no shell do serviço:

```bash
# Idempotente — adiciona apenas colunas/tabelas novas
npx prisma db push
```

Sem perda de dados (todas as colunas adicionadas são opcionais; tabela `EnglishCoachUsage` é nova).

### 🟠 3. Rodar backfill 1x em produção

**Sem isso, premiums atuais nunca expiram.**

```bash
# Render shell
npm run job:backfill-subscription-ends           # dry-run, lista candidatos
npm run job:backfill-subscription-ends -- --apply # aplica
```

Define `subscriptionEndsAt = updatedAt + 30 dias` apenas para users com `subscriptionStatus='active'` E `subscriptionEndsAt IS NULL`.

### 🟠 4. Configurar cron externo de downgrade

O script `expire-subscriptions.js` precisa rodar **diariamente**. Três opções:

**Opção A — GitHub Actions (gratuito, recomendado)**

Criar `.github/workflows/expire-subscriptions.yml` no repo:

```yaml
name: Expire Subscriptions
on:
  schedule:
    - cron: '5 3 * * *'  # 03:05 UTC todo dia (00:05 BRT)
  workflow_dispatch:

jobs:
  expire:
    runs-on: ubuntu-latest
    steps:
      - run: |
          curl -X POST \
            -H "x-jobs-secret: ${{ secrets.JOBS_SECRET }}" \
            -f https://englishgame-y5vg.onrender.com/api/admin/jobs/expire-subscriptions
```

Configurar `JOBS_SECRET` em GitHub Settings → Secrets → Actions.

**Opção B — cron-job.org (gratuito, sem Git)**

- Criar conta em https://cron-job.org
- Novo job: URL do endpoint, header `x-jobs-secret: <seu_secret>`, schedule diário
- Salvar e ativar

**Opção C — Render Cron Jobs (pago, formal)**

- Render Dashboard → New → Cron Job
- Command: `npm run job:expire-subscriptions`
- Schedule: `5 3 * * *`
- Plano: a partir de $1/mês

### 🟢 5. Decidir sobre voice (Coach)

`/voice/tts` (ElevenLabs) e `/voice/stt` (OpenAI Whisper) seguem **liberados a free users**, com apenas rate-limit de 20/min. Custo similar ao chat. Considere para Sprint 1:

- Aplicar `isPremiumUser()` no `/voice/tts` e `/voice/stt`
- Ou cota daily separada (ex.: 10 segundos de TTS/dia free)

### 🟢 6. Métricas financeiras (P1, próxima sprint)

`metricsService.js` calcula MRR sem distinguir mensal/anual e churn com `updatedAt` impreciso. Não corrigido no Sprint 0 — vai pra Sprint 1.

### 🟢 7. Validação HMAC do webhook MP (P1)

Hoje qualquer um pode forjar `POST /api/payments/mercadopago/notification`. Ele puxa o pagamento na API real do MP, então não há fraude direta — mas é vetor de DoS. Adicionar verificação `x-signature` na próxima sprint.

## Rollback

Cada passo é commit isolado. Em caso de problema:

```bash
git revert <hash-do-commit>
```

Para reverter o schema:
```bash
# Remover lastPaymentId e EnglishCoachUsage manualmente
npx prisma db push --force-reset  # ⚠ apaga dados!
```

(Em produção, **não** use `--force-reset`. Faça migration reversa manual.)
