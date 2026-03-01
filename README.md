# API English Cards

Backend Node + Express + Prisma para o app English Cards. Suporta autenticação, sincronização de dados e integração com Stripe para assinaturas.

## Setup

1. Instale as dependências:
   ```bash
   npm install
   ```

2. Crie o arquivo `.env` (copie de `.env.example`) e ajuste se necessário:
   - `DATABASE_URL`: SQLite em dev (`file:./dev.db`). Em produção use Postgres: `postgresql://user:pass@host:5432/dbname`
   - `JWT_SECRET`: segredo para tokens (use um valor forte em produção)
   - `STRIPE_*`: preencha quando for ativar pagamentos

3. Gere o Prisma Client e crie o banco:
   ```bash
   npx prisma generate
   npx prisma db push
   ```

4. Inicie a API:
   ```bash
   npm run dev
   ```
   A API sobe em `http://localhost:3001` (ou a porta em `PORT`).

## Endpoints principais

- `POST /api/auth/register` — Cadastro (email, password, name?)
- `POST /api/auth/login` — Login
- `GET /api/auth/me` — Dados do usuário (Bearer token)
- `GET /api/auth/google` — Inicia login com Google (redirect OAuth)
- `GET /api/auth/google/callback` — Callback Google
- `GET /api/auth/facebook` — Inicia login com Facebook
- `GET /api/auth/facebook/callback` — Callback Facebook
- `GET /api/auth/apple` — Inicia login com Apple
- `POST /api/auth/apple/callback` — Callback Apple (POST; Apple envia form)
- `GET /api/sync` — Carrega todos os dados do usuário (grupos, cards, decks, livros, preferências)
- `GET/POST/PATCH/DELETE /api/groups` — CRUD de grupos
- `GET/POST/PATCH/DELETE /api/cards` — CRUD de cards
- `PUT /api/memory` — Salvar decks de memória
- `PUT /api/books` — Salvar livros customizados
- `PUT /api/preferences` — Preferências (selectedGroupId, readerTheme)
- `POST /api/payments/create-checkout-session` — Iniciar assinatura (Mercado Pago ou Stripe)
- `POST /api/payments/create-portal-session` — Portal Stripe (se usar Stripe)
- `GET /api/payments/mercadopago/notification` — Notificação Mercado Pago (pagamento aprovado)
- `POST /api/payments/mercadopago/simulate-notification` — (só dev) Simula assinatura ativa
- `POST /api/payments/mercadopago/simulate-clear-subscription` — (só dev) Simula plano gratuito
- `POST /api/payments/webhook` — Webhook Stripe (se usar Stripe)

## Login social (Google, Facebook)

1. **Google:** Crie credenciais OAuth 2.0 no [Google Cloud Console](https://console.cloud.google.com/apis/credentials). Defina no `.env`:
   - `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`
   - Callback autorizado: `http://localhost:3001/api/auth/google/callback` (dev) ou `https://sua-api.com/api/auth/google/callback` (produção)
   - Opcional: `API_URL=http://localhost:3001` (usado para montar a callback URL)

2. **Facebook:** Crie um app em [developers.facebook.com](https://developers.facebook.com). Defina no `.env`:
   - `FACEBOOK_APP_ID`, `FACEBOOK_APP_SECRET`
   - URL de redirect de login válida: `http://localhost:3001/api/auth/facebook/callback` (ou sua URL de produção)

3. **Apple:** No [Apple Developer](https://developer.apple.com/): crie um **Service ID** (ex.: `com.yourapp.signin`), ative "Sign in with Apple", e crie uma **Key** (Sign in with Apple) para obter o arquivo `.p8`. No `.env`:
   - `APPLE_CLIENT_ID` = Service ID
   - `APPLE_TEAM_ID` = Team ID da conta
   - `APPLE_KEY_ID` = Key ID da chave
   - `APPLE_PRIVATE_KEY_PATH` = caminho do arquivo `.p8` **ou** `APPLE_PRIVATE_KEY` = conteúdo da chave (use `\n` para quebras de linha)
   - URLs de retorno no Service ID: `https://sua-api.com/api/auth/apple/callback` (produção; em dev use `http://localhost:3001/...` se o Apple permitir)

4. Após alterar o schema (ex.: login social), rode `npx prisma db push` para aplicar no banco.

## Mercado Pago

1. Com `MERCADOPAGO_ACCESS_TOKEN` definido no `.env`, o botão "Assinar agora" cria uma preferência no Mercado Pago e redireciona para o checkout (em teste use credenciais TEST-*; a URL retornada é `sandbox_init_point`).
2. Opcional: `MERCADOPAGO_PLAN_PRICE=9.9` (valor em BRL). Padrão: 9.9.
3. **Notificação:** o Mercado Pago chama `API_URL/api/payments/mercadopago/notification?topic=payment&id=...` quando o pagamento é atualizado. Em produção, `API_URL` deve ser uma URL pública (ex.: `https://api.seudominio.com`).
4. **Testar no localhost (disables de features / plano ativo vs gratuito):**
   - Na aba **Conta** do app, em modo dev (`npm run dev`) aparecem dois botões só em desenvolvimento:
     - **"Simular pagamento aprovado (dev)"** — marca o usuário como assinante (`subscriptionStatus: 'active'`). Use para testar a UI e as features liberadas com plano ativo.
     - **"Simular plano gratuito (dev)"** — volta o usuário para plano gratuito (`subscriptionStatus` null). Use para testar os disables (features bloqueadas para não assinantes).
   - Assim você alterna entre os dois estados sem criar outra conta e sem túnel.
   - **Fluxo completo (checkout real + webhook):** use um túnel HTTPS (ex.: [ngrok](https://ngrok.com)) com `API_URL=https://seu-subdominio.ngrok.io` se quiser testar a notificação do MP em localhost.

## Stripe (opcional)

1. Crie um produto e preço de assinatura no Stripe.
2. Defina `STRIPE_SECRET_KEY`, `STRIPE_PRICE_ID` e `STRIPE_WEBHOOK_SECRET` no `.env`.
3. No Stripe Dashboard, configure o webhook para `https://seu-dominio/api/payments/webhook` e eventos como `checkout.session.completed`, `customer.subscription.updated`, `customer.subscription.deleted`.

## Produção (aplicação na web)

Para a aplicação funcionar em produção (checkout, notificações e redirects):

1. **URLs em HTTPS (obrigatório para Mercado Pago):**
   - `API_URL` = URL pública do backend (ex.: `https://api.seudominio.com`)
   - `FRONTEND_URL` = URL do front (ex.: `https://app.seudominio.com` ou `https://seudominio.com`)
   - Com isso o backend envia `notification_url` e `auto_return`, e o MP consegue chamar sua API quando o pagamento for aprovado.

2. **Banco e migrações:**
   - Use **PostgreSQL**: `DATABASE_URL=postgresql://user:pass@host:5432/dbname`
   - Rode `npx prisma migrate deploy` (ou `prisma db push` se não usar migrações).

3. **Segredos:** defina `JWT_SECRET` forte e, se usar Stripe, as variáveis `STRIPE_*`.

4. **Mercado Pago:** use o **Access Token de produção** (não `TEST-*`) e, no painel do MP, cadastre a URL de notificação se exigido. A notificação é `GET API_URL/api/payments/mercadopago/notification?topic=payment&id=...`.

5. **Simulação em produção:** os endpoints `POST /api/payments/mercadopago/simulate-notification` e `simulate-clear-subscription` **não existem** quando `NODE_ENV=production`; só aparecem em dev para testar disables de features.
