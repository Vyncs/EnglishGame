/**
 * GET /api/activity?from=YYYY-MM-DD&to=YYYY-MM-DD
 *
 * Histórico de atividade diária — usado pelo calendário /perfil e por
 * cohort analytics. Retorna apenas o range solicitado (default: últimos 90 dias).
 */

import { Router } from 'express';
import { authMiddleware } from '../middleware/auth.js';
import { getActivityRange } from '../services/streakService.js';
import { localDate } from '../services/timeService.js';

const router = Router();
router.use(authMiddleware);

const MAX_DAYS = 366; // limite de range pra evitar query gigante

router.get('/', async (req, res, next) => {
  try {
    const { from, to } = req.query;

    let fromDate = typeof from === 'string' ? from : null;
    let toDate = typeof to === 'string' ? to : null;

    // Default: últimos 90 dias até hoje (UTC — ok pra histórico)
    if (!toDate) toDate = localDate('UTC');
    if (!fromDate) {
      const d = new Date();
      d.setUTCDate(d.getUTCDate() - 90);
      fromDate = localDate('UTC', d);
    }

    if (!isValidDate(fromDate) || !isValidDate(toDate)) {
      return res.status(400).json({ error: 'Datas devem estar no formato YYYY-MM-DD' });
    }

    if (rangeDays(fromDate, toDate) > MAX_DAYS) {
      return res.status(400).json({ error: `Range máximo: ${MAX_DAYS} dias` });
    }

    const rows = await getActivityRange(req.user.id, fromDate, toDate);
    res.json({ from: fromDate, to: toDate, days: rows });
  } catch (e) {
    next(e);
  }
});

function isValidDate(s) {
  return typeof s === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(s);
}

function rangeDays(from, to) {
  const a = Date.UTC(...from.split('-').map((v, i) => (i === 1 ? Number(v) - 1 : Number(v))));
  const b = Date.UTC(...to.split('-').map((v, i) => (i === 1 ? Number(v) - 1 : Number(v))));
  return Math.round((b - a) / 86_400_000);
}

export default router;
