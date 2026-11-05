# Não deixar o Supabase pausar o projeto

## O problema

O Supabase no plano free pausa o projeto depois de **~7 dias com pouca atividade
de banco do usuário**. Como este app só encosta no Postgres quando alguém entra
no site, uma semana sem aluno nenhum é suficiente: o banco dorme, o Prisma passa
a responder `Tenant or user not found` e o login quebra até alguém clicar em
**Resume** no dashboard.

Pior: o `startCommand` do Render é `npx prisma db push && npm start`. Com o banco
pausado, o `db push` falha e o `npm start` nunca roda — ou seja, o banco dormindo
também derruba o deploy do backend.

A documentação do Supabase diz que **algumas requisições ao banco por dia** já
bastam para escapar da pausa. Daí a solução abaixo.

## As duas camadas

### 1. Heartbeat dentro do servidor

`src/utils/dbHeartbeat.js`. Faz `SELECT 1` a cada `DB_HEARTBEAT_MINUTES`
(padrão 360, ou seja 6 h → 4 batidas por dia), mais uma batida no boot. O timer
usa `unref()`, então nunca segura o processo vivo.

- `DB_HEARTBEAT_MINUTES=0` desliga.
- Os logs saem como `[db-heartbeat] banco ok em 180ms`.
- **Limite:** só vale enquanto o servidor está de pé. Se o Render suspender ou o
  serviço cair, esta camada para junto — que é exatamente quando o banco mais
  corre risco de dormir. Por isso existe a camada 2.

### 2. Cron do GitHub Actions

`.github/workflows/manter-banco-acordado.yml`, todo dia às 11:17 UTC
(08:17 em Brasília). Tenta dois caminhos e basta um funcionar:

| Caminho | Precisa de quê | Sobrevive ao backend fora do ar? |
|---|---|---|
| `psql` direto no Postgres | secret `DATABASE_URL` no repositório | **sim** |
| `GET /api/health/db` | nada | não |

Para ligar o caminho direto (recomendado, é o único à prova de suspensão do
Render):

```bash
gh secret set DATABASE_URL --repo Vyncs/EnglishGame
# cole a mesma connection string que está no Render
```

Rodar na hora, sem esperar o horário: aba **Actions** → *Manter banco acordado* →
**Run workflow**.

### Dois detalhes que mordem

- O GitHub **desliga workflows agendados depois de 60 dias sem commit** no
  repositório. Ele avisa por email e basta um clique para religar.
- Cron de Actions não é horário exato; em horário de pico o job pode atrasar
  bastante. Por isso o agendamento é diário e não semanal: com 7 dias de folga,
  um atraso de algumas horas não derruba nada.

## O endpoint

`GET /api/health/db` → `{ "ok": true, "db": "up", "ms": 180, "ts": "..." }`,
ou **503** com `{ "ok": false, "db": "down" }`.

Diferente de `/api/health`, que é de propósito uma resposta leve **sem** tocar no
banco (serve para monitor de uptime). O `/db` é o que gera atividade real.

Fica sem autenticação para o workflow não precisar guardar segredo: o que ele faz
é um `SELECT 1`, o `standardLimiter` corta em 100 chamadas por IP a cada 15 min,
e a resposta não devolve nenhum detalhe de conexão.

## Se mesmo assim pausar

1. Dashboard do Supabase → projeto → **Resume project**. Leva alguns minutos.
2. Confira se o workflow não está vermelho ou desligado na aba Actions.
3. Confira se o `DB_HEARTBEAT_MINUTES` do Render não ficou em `0`.

O projeto pausado pode ser restaurado por até **90 dias**. Depois disso só resta
baixar o backup.
