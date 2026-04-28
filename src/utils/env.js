/**
 * Validação de variáveis de ambiente críticas no boot.
 * Em produção, falha alto se segredos estão ausentes/fracos.
 */

const isProd = process.env.NODE_ENV === 'production';

function fail(msg) {
  console.error(`\n❌ [env] ${msg}\n`);
  process.exit(1);
}

/**
 * Retorna o JWT_SECRET validado.
 * - Em produção: deve estar setado e ter pelo menos 32 caracteres.
 * - Em dev: aceita fallback explícito, mas avisa.
 */
export function getJwtSecret() {
  const secret = process.env.JWT_SECRET;
  if (isProd) {
    if (!secret) fail('JWT_SECRET é obrigatório em produção. Gere com: openssl rand -base64 32');
    if (secret.length < 32) fail('JWT_SECRET fraco (< 32 chars). Regenere com: openssl rand -base64 32');
    return secret;
  }
  if (!secret) {
    console.warn('⚠️  [env] JWT_SECRET ausente — usando fallback de DEV. NÃO use em produção.');
    return 'dev-only-not-for-production-use-openssl-rand-base64-32';
  }
  return secret;
}

/**
 * Retorna JOBS_SECRET (cron externo) validado.
 * - Em produção, é obrigatório se algum job HTTP for usado.
 * - O endpoint que consome cuida da validação fina; aqui só normalizamos.
 */
export function getJobsSecret() {
  return process.env.JOBS_SECRET || null;
}

/**
 * Indica se endpoints de DEV (`/simulate-*`) devem ser montados.
 * Requer DUPLO opt-in: NODE_ENV != production E ENABLE_DEV_ENDPOINTS=true.
 */
export function devEndpointsEnabled() {
  if (isProd) return false;
  return process.env.ENABLE_DEV_ENDPOINTS === 'true';
}

export const IS_PROD = isProd;
