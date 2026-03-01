# Conectar o backend ao Supabase (PostgreSQL)

O backend usa **Prisma** e se conecta ao Postgres do Supabase pela **connection string direta**. A **Project URL** e a **Publishable Key** do Supabase são para a Data API / cliente no front; o backend só precisa do **banco PostgreSQL**.

---

## 1. Pegar a senha do banco

1. Acesse o [Dashboard do Supabase](https://supabase.com/dashboard) e abra seu projeto.
2. Vá em **Project Settings** (ícone de engrenagem) → **Database**.
3. Em **Database Password**:
   - Se você definiu senha ao criar o projeto, use essa senha.
   - Se não lembra, use **Reset database password**, defina uma nova e guarde.

---

## 2. Connection string (Direct)

Na mesma página **Database**, em **Connection string** escolha **URI** e copie a **Direct** (porta 5432). Ela vem assim:

```text
postgresql://postgres:[YOUR-PASSWORD]@db.zgrifgnfmedmwditqqix.supabase.co:5432/postgres
```

Substitua `[YOUR-PASSWORD]` pela senha real do banco. O Supabase exige SSL, então adicione no final:

```text
?sslmode=require
```

Exemplo final (troque `SUA_SENHA` pela senha real):

```text
postgresql://postgres:SUA_SENHA@db.zgrifgnfmedmwditqqix.supabase.co:5432/postgres?sslmode=require
```

Se a senha tiver caracteres especiais (ex.: `#`, `@`, `%`), use [URL encode](https://www.urlencoder.org/) nela antes de colar na URL.

---

## 3. Configurar o backend

No **backend** (pasta `backend/`):

1. Abra o arquivo **`.env`**.
2. Defina `DATABASE_URL` com a connection string completa (incluindo `?sslmode=require`):

```env
DATABASE_URL="postgresql://postgres:SUA_SENHA@db.zgrifgnfmedmwditqqix.supabase.co:5432/postgres?sslmode=require"
```

3. Use o schema **PostgreSQL** do Prisma (o backend já tem `schema.postgres.prisma`). No terminal, na pasta `backend/`:

```bash
cp prisma/schema.postgres.prisma prisma/schema.prisma
npx prisma generate
npx prisma db push
```

- `prisma generate` gera o client para Postgres.
- `prisma db push` cria/atualiza as tabelas no Supabase.

Depois disso, suba o backend (`npm run dev` ou `npm start`). Ele estará usando o Postgres do Supabase.

---

## 4. Resumo

| Onde | O que usar |
|------|------------|
| **Backend (Prisma)** | `DATABASE_URL` = connection string **Direct** (porta 5432) + `?sslmode=require` |
| **Project URL / Publishable Key** | Usar no **frontend** se for chamar a Data API ou Auth do Supabase; o backend atual usa só o Postgres via Prisma |

Se aparecer erro de SSL, confira se `?sslmode=require` está no final da `DATABASE_URL` (sem espaço).
