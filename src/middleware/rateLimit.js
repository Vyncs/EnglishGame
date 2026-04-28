import rateLimit from 'express-rate-limit';

/**
 * Rate limiters reutilizáveis. Store padrão é em memória — ok para 1 instância
 * (Render free tier). Ao escalar para múltiplas instâncias, trocar para
 * `rate-limit-redis` (compartilha contagem entre processos).
 *
 * Cada limiter tem bucket INDEPENDENTE: esgotar verify-email não bloqueia
 * o user de chamar /resend-verification ou /login.
 *
 * Chave: IP + email (quando disponível) — evita que um IP queime a cota com
 * múltiplos emails E que um email seja brute-forçado de IPs diferentes.
 */

const KEY_BY_IP_AND_EMAIL = (req) => {
  const email = (req.body?.email || '').toString().trim().toLowerCase();
  // req.ip é populado pelo Express quando 'trust proxy' está setado.
  return `${req.ip}:${email}`;
};

const STANDARD_HEADERS = { standardHeaders: 'draft-7', legacyHeaders: false };

/**
 * /login — anti-brute-force.
 * 5 tentativas / 15min. Justo para usuário esquecido, restritivo para atacante.
 */
export const loginLimiter = rateLimit({
  ...STANDARD_HEADERS,
  windowMs: 15 * 60 * 1000,
  limit: 5,
  keyGenerator: KEY_BY_IP_AND_EMAIL,
  message: {
    error: 'Muitas tentativas de login. Aguarde 15 minutos antes de tentar novamente.',
    code: 'AUTH_LOGIN_RATE_LIMIT',
  },
});

/**
 * /register — anti-spam de cadastros.
 * 3 cadastros / 1h por IP+email. Cadastro é evento raro; spammers tentam em massa.
 */
export const registerLimiter = rateLimit({
  ...STANDARD_HEADERS,
  windowMs: 60 * 60 * 1000,
  limit: 3,
  keyGenerator: KEY_BY_IP_AND_EMAIL,
  message: {
    error: 'Muitos cadastros recentes deste IP. Aguarde 1 hora antes de tentar novamente.',
    code: 'AUTH_REGISTER_RATE_LIMIT',
  },
});

/**
 * /verify-email — usuário pode digitar o código errado várias vezes.
 * 10 tentativas / 15min é generoso o suficiente para erro humano,
 * sem permitir brute-force do código de 6 dígitos (1M combinações).
 */
export const verifyEmailLimiter = rateLimit({
  ...STANDARD_HEADERS,
  windowMs: 15 * 60 * 1000,
  limit: 10,
  keyGenerator: KEY_BY_IP_AND_EMAIL,
  message: {
    error: 'Muitas tentativas de verificação. Aguarde 15 minutos.',
    code: 'AUTH_VERIFY_RATE_LIMIT',
  },
});

/**
 * /resend-verification — limite forte (cada envio custa 1 email no Resend).
 * 3 reenvios / 1h. Bucket independente: se o user esgotar verify-email,
 * ainda pode pedir um novo código aqui.
 */
export const resendVerificationLimiter = rateLimit({
  ...STANDARD_HEADERS,
  windowMs: 60 * 60 * 1000,
  limit: 3,
  keyGenerator: KEY_BY_IP_AND_EMAIL,
  message: {
    error: 'Muitos reenvios de código. Aguarde 1 hora antes de pedir outro.',
    code: 'AUTH_RESEND_RATE_LIMIT',
  },
});

/** 100 reqs / 15 min por IP — uso geral, reservado para futuro. */
export const standardLimiter = rateLimit({
  ...STANDARD_HEADERS,
  windowMs: 15 * 60 * 1000,
  limit: 100,
  message: { error: 'Muitas requisições. Aguarde alguns minutos.' },
});

/**
 * @deprecated Mantido apenas para compatibilidade temporária com importadores
 * antigos. Novos usos devem importar o limiter específico (loginLimiter, etc).
 * Será removido na Sprint 1.
 */
export const authLimiter = loginLimiter;
