# Configurar Sign in with Apple (iOS / Web)

O backend já está pronto. Falta criar as credenciais no **Apple Developer** e preencher o `.env`.

**Requisito:** conta **Apple Developer** paga (US$ 99/ano) – https://developer.apple.com/programs/

---

## Resumo do que você vai criar

| Onde | O que | Para que |
|------|--------|----------|
| Identificadores | **App ID** (ex: `com.yourapp.englishcards`) | Ativar "Sign in with Apple" |
| Identificadores | **Services ID** (ex: `com.yourapp.englishcards.signin`) | É o **APPLE_CLIENT_ID** no .env |
| Chaves | **Key** "Sign in with Apple" | Gera o arquivo .p8 → **APPLE_KEY_ID** + chave privada |
| Conta | **Team ID** | No canto da conta Apple Developer |

---

## Passo 1 – Anotar o Team ID e o Bundle ID (ou criar App ID)

1. Acesse: **https://developer.apple.com/account**
2. **Team ID:** no canto direito (ou em Membership) → anote o **Team ID** (ex: `ABCD1234`) → será **APPLE_TEAM_ID**.
3. Vá em **Identificadores** → **+** para criar um **App ID** (se ainda não tiver):
   - Descrição: ex. "English Cards"
   - Bundle ID: explícito, ex. `com.yourapp.englishcards`
   - Marque **Sign in with Apple** → Continuar → Registrar.

---

## Passo 2 – Criar o Services ID (é o Client ID do “Sign in with Apple” na web)

1. Em **Identificadores** → **+** → escolha **Services IDs** → Continuar.
2. **Descrição:** ex. "English Cards Web"
3. **Identifier:** ex. `com.yourapp.englishcards.signin` → este valor é o **APPLE_CLIENT_ID** no `.env`.
4. Marque **Sign in with Apple** → **Configurar** ao lado.
5. **Primary App ID:** selecione o App ID que você criou no passo 1.
6. **Domains and Subdomains:**  
   - Em **desenvolvimento:** pode usar um domínio de tunnel (ex. `abc123.ngrok.io`) ou o domínio que você usa no front/back.  
   - A Apple exige **HTTPS** na Return URL. Para testar em localhost, use um tunnel (ex. **ngrok**): `ngrok http 3001` e use a URL gerada (ex. `https://abc123.ngrok.io`).
7. **Return URLs:** adicione a URL do seu backend que recebe o callback da Apple, por exemplo:
   - Com ngrok (dev): `https://SEU-SUBDOMINIO.ngrok.io/api/auth/apple/callback`
   - Produção: `https://api.seudominio.com/api/auth/apple/callback`
8. Salvar → Continuar → Registrar.

---

## Passo 3 – Criar a Key (Sign in with Apple)

1. Em **Chaves** (Keys) → **+**.
2. Nome: ex. "English Cards Sign in with Apple".
3. Marque **Sign in with Apple** → **Configurar** → escolha o **Primary App ID** (o mesmo do passo 1) → Registrar.
4. **Baixe o arquivo .p8** (só pode baixar uma vez). Guarde em pasta segura.
5. Anote o **Key ID** (ex: `XYZ123ABC`) → será **APPLE_KEY_ID** no `.env`.

---

## Passo 4 – Preencher o `.env` do backend

No arquivo **`backend/.env`** adicione (ou descomente e preencha):

```env
# Sign in with Apple
APPLE_CLIENT_ID=com.yourapp.englishcards.signin
APPLE_TEAM_ID=ABCD1234
APPLE_KEY_ID=XYZ123ABC
APPLE_PRIVATE_KEY_PATH=C:\caminho\completo\para\AuthKey_XYZ123ABC.p8
```

- **APPLE_CLIENT_ID** = Services ID (Identifier do passo 2).
- **APPLE_TEAM_ID** = Team ID da conta.
- **APPLE_KEY_ID** = Key ID da chave que você criou.
- **APPLE_PRIVATE_KEY_PATH** = caminho completo do arquivo `.p8` no seu PC.

**Alternativa à pasta:** em vez de `APPLE_PRIVATE_KEY_PATH`, você pode colar o **conteúdo** do arquivo `.p8` no `.env` (uma linha só, com `\n` onde tiver quebra de linha):

```env
APPLE_PRIVATE_KEY="-----BEGIN PRIVATE KEY-----\nMIGT...\n-----END PRIVATE KEY-----"
```

Reinicie o backend e teste o botão **Apple** na tela de login.

---

## Testar em localhost (Apple exige HTTPS no callback)

A Apple não aceita `http://localhost` como Return URL. Para testar no seu PC:

1. Instale o **ngrok**: https://ngrok.com/download  
2. No terminal: `ngrok http 3001` (com o backend rodando na porta 3001).  
3. Copie a URL HTTPS que o ngrok mostrar (ex. `https://abc123.ngrok-free.app`).  
4. No Apple Developer, no **Services ID** → **Sign in with Apple** → **Return URLs**, adicione:  
   `https://abc123.ngrok-free.app/api/auth/apple/callback`  
   (troque pelo seu subdomínio ngrok).  
5. No `.env` do backend:
   ```env
   APPLE_CALLBACK_URL=https://abc123.ngrok-free.app/api/auth/apple/callback
   ```
6. No frontend, o botão Apple deve abrir a tela da Apple; ao autorizar, o callback vai para o ngrok → seu backend.  
7. Para o front redirecionar para o backend via ngrok em dev, você pode definir no front (ou no backend) a base da API como a URL do ngrok só para o fluxo Apple, ou usar o mesmo ngrok para a API inteira em dev.

Resumo: **backend já integrado**; você só precisa criar App ID, Services ID e Key no Apple Developer, preencher o `.env` e, para testar, usar uma Return URL **HTTPS** (ex. via ngrok).
