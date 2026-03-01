# Configurar Google Login (redirect_uri_mismatch)

O app já está certo. Falta **só você** cadastrar a URL no Google (leva 1 minuto).

---

## 1. Abrir a tela de credenciais

Abra este link (entrando com a conta Google do projeto):

**https://console.cloud.google.com/apis/credentials**

---

## 2. Escolher o cliente OAuth

- Clique no **nome** do cliente cujo Client ID é:
  `890400183577-605kd9f0eqt8fkaag5urjea01s93s3ej.apps.googleusercontent.com`

- Se o **tipo** for **"Aplicativo para computador"** (Desktop), não aceita localhost. Aí faça:
  - **Criar credenciais** → **ID do cliente OAuth**
  - Tipo: **Aplicativo da Web**
  - Nome: ex. "English Cards Web"
  - Em **URIs de redirecionamento autorizados** → **+ ADICIONAR URI** → cole a URL do passo 3 → **Criar**
  - Copie o novo **Client ID** e **Client secret** e coloque no `.env` do backend (substituindo GOOGLE_CLIENT_ID e GOOGLE_CLIENT_SECRET).

- Se o tipo já for **"Aplicativo da Web"**, vá para o passo 3.

---

## 3. Adicionar a URI de redirecionamento

Na tela do cliente OAuth, em **URIs de redirecionamento autorizados**:

1. Clique em **+ ADICIONAR URI**.
2. Cole **exatamente** isto (copie da linha abaixo):

```
http://localhost:3001/api/auth/google/callback
```

3. Clique em **SALVAR** (embaixo da página).

---

## 4. Testar

Espere ~1 minuto e tente de novo **Entrar com Google** no app.
