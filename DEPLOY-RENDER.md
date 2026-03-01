# Deploy do backend no Render

Passo a passo para subir a API English Cards no [Render](https://render.com) como **Web Service** com **PostgreSQL**.

---

## 1. Preparar o repositório

O backend precisa estar em um repositório Git (GitHub, GitLab ou Bitbucket). Se o backend estiver dentro de um monorepo (pasta `backend/` junto com `frontend/`), você pode:

- **Opção A:** Ter um repositório só com a pasta `backend` (copie o conteúdo da pasta backend para um repo novo e faça push), **ou**
- **Opção B:** Usar o mesmo repositório e no Render informar o **Root Directory** como `backend` (Render suporta isso), **ou**
- **Opção C (Blueprint):** Usar o arquivo `render.yaml` na raiz do projeto: no Render, **New +** → **Blueprint** e selecione o repositório. O Render criará o Web Service e o PostgreSQL a partir do YAML; depois configure no Dashboard as variáveis sensíveis (JWT_SECRET, FRONTEND_URL, API_URL, Mercado Pago, etc.).

---

## 2. Criar conta e novo serviço no Render

1. Acesse [render.com](https://render.com) e faça login (ou crie conta com GitHub/GitLab).
2. No dashboard, clique em **New +** → **Web Service**.
3. Conecte seu repositório (autorize Render se precisar).
4. Se o backend estiver numa subpasta, em **Root Directory** informe: `backend` (ou o nome da pasta onde está o `package.json`). Deixe em branco se a raiz do repo já for o backend.

---

## 3. Configurar o Web Service

| Campo | Valor |
|-------|--------|
| **Name** | Ex.: `english-cards-api` |
| **Region** | Escolha o mais próximo dos usuários (ex.: Oregon ou Frankfurt) |
| **Branch** | `main` (ou a branch que você usa) |
| **Runtime** | `Node` |
| **Build Command** | `npm install && cp prisma/schema.postgres.prisma prisma/schema.prisma && npx prisma generate` |
| **Start Command** | `npx prisma db push && npm start` |

- **Build Command:** instala dependências, troca o schema do Prisma para PostgreSQL e gera o client.
- **Start Command:** aplica as tabelas no Postgres (`db push`) e sobe o servidor com `npm start`.

---

## 4. Adicionar o banco PostgreSQL

1. No dashboard do Render, clique em **New +** → **PostgreSQL**.
2. Crie o banco (ex.: nome `english_cards_db`), região igual à do Web Service.
3. Após criar, abra o banco e vá em **Info** (ou **Connect**). Copie a **Internal Database URL** (recomendado para o mesmo Render) ou **External Database URL** se precisar acessar de fora.
4. A URL tem o formato:  
   `postgresql://usuario:senha@host:5432/nome_do_banco`  
   Às vezes aparece com `?sslmode=require` no final; pode deixar.

---

## 5. Variáveis de ambiente no Web Service

No seu **Web Service** → aba **Environment** → **Add Environment Variable**. Adicione:

| Variável | Valor | Obrigatório |
|----------|--------|-------------|
| `DATABASE_URL` | A **Internal Database URL** do PostgreSQL que você criou | Sim |
| `JWT_SECRET` | Uma string longa e aleatória (ex.: gere com `openssl rand -base64 32`) | Sim |
| `NODE_ENV` | `production` | Sim |
| `PORT` | Deixe em branco; o Render injeta a porta automaticamente | Opcional |

> **Nota:** Se usar o Blueprint (`render.yaml` na raiz do repo), `DATABASE_URL` é preenchida automaticamente. As demais variáveis devem ser adicionadas no Dashboard do serviço após o primeiro deploy.
| `API_URL` | URL pública do seu backend no Render, ex.: `https://english-cards-api.onrender.com` | Sim (callbacks OAuth e notificação MP) |
| `FRONTEND_URL` | URL do front (ex.: Netlify), ex.: `https://seu-app.netlify.app` | Sim (CORS e redirects) |
| `MERCADOPAGO_ACCESS_TOKEN` | Access Token de **produção** do Mercado Pago (não use `TEST-`) | Se for usar MP |
| `MERCADOPAGO_PLAN_PRICE_MONTHLY` | Ex.: `19.99` (plano mensal) | Opcional (padrão 19.99) |
| `MERCADOPAGO_PLAN_PRICE_ANNUAL` | Ex.: `179` (plano anual) | Opcional (padrão 179) |
| `GOOGLE_CLIENT_ID` | Client ID do Google OAuth | Se usar login Google |
| `GOOGLE_CLIENT_SECRET` | Client Secret do Google | Se usar login Google |
| `APPLE_CLIENT_ID` | Service ID (Sign in with Apple) | Se usar Apple |
| `APPLE_TEAM_ID` | Team ID | Se usar Apple |
| `APPLE_KEY_ID` | Key ID da chave .p8 | Se usar Apple |
| `APPLE_PRIVATE_KEY` ou `APPLE_PRIVATE_KEY_PATH` | Conteúdo da chave .p8 ou caminho | Se usar Apple |

**Importante:**

- `API_URL` deve ser exatamente a URL do Web Service no Render (ex.: `https://english-cards-api.onrender.com`), **sem** barra no final.
- `FRONTEND_URL` deve ser a URL do front (ex.: Netlify), para CORS e redirects pós-login e Mercado Pago.

---

## 6. Deploy

1. Clique em **Create Web Service** (ou **Save** se já tiver criado).
2. O Render vai rodar o **Build** e depois o **Start**. A primeira vez pode demorar um pouco.
3. Nos **Logs** você deve ver algo como: `API rodando em http://localhost:3001`.
4. Teste no navegador:  
   `https://SEU-SERVICO.onrender.com/api/health`  
   Deve retornar: `{"ok":true}`.

---

## 7. Callbacks OAuth e Mercado Pago

- **Google / Facebook / Apple:** Nas configurações de cada provedor, cadastre as URLs de **produção**:
  - Google: `https://SEU-SERVICO.onrender.com/api/auth/google/callback`
  - Facebook: idem para `/api/auth/facebook/callback`
  - Apple: idem para `/api/auth/apple/callback` (e no Service ID da Apple).
- **Mercado Pago:** A notificação de pagamento usará `API_URL/api/payments/mercadopago/notification`. Não é necessário cadastrar manualmente em geral; use o Access Token de produção.

---

## 8. Frontend (Netlify ou outro)

No frontend, configure a variável que aponta para a API, por exemplo:

- **Netlify:** Environment variables → `VITE_API_URL` = `https://SEU-SERVICO.onrender.com` (ou o nome da variável que seu `api/client` usa).
- O front deve fazer as requisições para essa URL em produção.

---

## 9. Free tier e “spin down”

No plano gratuito, o Web Service “dorme” após um tempo sem acesso. A primeira requisição depois disso pode levar alguns segundos (cold start). O Postgres gratuito também tem limitações; para uso real, avalie um plano pago.

---

## Resumo rápido

1. **New +** → **Web Service** → conectar repo → Root Directory = `backend` (se for o caso).  
2. **Build Command:** `npm install && cp prisma/schema.postgres.prisma prisma/schema.prisma && npx prisma generate`  
3. **Start Command:** `npx prisma db push && npm start`  
4. **New +** → **PostgreSQL** → criar banco → copiar **Internal Database URL**.  
5. No Web Service → **Environment** → definir `DATABASE_URL`, `JWT_SECRET`, `NODE_ENV`, `API_URL`, `FRONTEND_URL` e as demais variáveis necessárias.  
6. **Create Web Service** e testar `/api/health`.

Se algo falhar, confira os **Logs** do serviço no Render; a maioria dos erros é por variável de ambiente faltando ou `DATABASE_URL` incorreta.
