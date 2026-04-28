import crypto from 'crypto';

/**
 * Middleware para endpoints de jobs internos (cron externo HTTP).
 * Autentica via header `x-jobs-secret` em comparação constant-time.
 *
 * Em produção: exige JOBS_SECRET na env. Sem env → 503.
 * Em dev: se JOBS_SECRET vazio, exige opt-in via NODE_ENV != production
 * mas SEMPRE rejeita se header ausente.
 */
export function jobsAuth(req, res, next) {
  const expected = process.env.JOBS_SECRET;
  if (!expected) {
    return res.status(503).json({ error: 'JOBS_SECRET não configurado no servidor' });
  }
  const provided = req.header('x-jobs-secret') || '';
  // timingSafeEqual exige buffers do mesmo tamanho.
  const a = Buffer.from(expected, 'utf8');
  const b = Buffer.from(provided, 'utf8');
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) {
    return res.status(401).json({ error: 'Acesso não autorizado' });
  }
  next();
}
