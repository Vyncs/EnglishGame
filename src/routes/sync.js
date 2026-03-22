// Uma única rota para carregar todos os dados do usuário (evita várias requisições no load)
import { Router } from 'express';
import prisma from '../db.js';
import { authMiddleware } from '../middleware/auth.js';
import { isPremiumUser } from '../utils/subscription.js';
import { toGroupResponse } from './groups.js';
import { toCardResponse } from './cards.js';

const router = Router();
router.use(authMiddleware);

// GET /api/sync — retorna groups, cards, memoryDecks, hiddenDefaultDeckIds, customBooks, preferences
router.get('/', async (req, res, next) => {
  try {
    const userId = req.user.id;
    const [groups, cards, memoryData, customBooksRow, prefs] = await Promise.all([
      prisma.group.findMany({
        where: { userId },
        orderBy: { createdAt: 'asc' },
      }),
      prisma.card.findMany({
        where: { userId },
        orderBy: { createdAt: 'asc' },
      }),
      prisma.userMemoryData.findUnique({ where: { userId } }),
      prisma.userCustomBooks.findUnique({ where: { userId } }),
      prisma.userPreferences.findUnique({ where: { userId } }),
    ]);

    let memoryDecks = [];
    let hiddenDefaultDeckIds = [];
    try {
      if (memoryData?.decks) {
        memoryDecks = JSON.parse(memoryData.decks);
      }
      if (memoryData?.hiddenDefaultDeckIds) {
        hiddenDefaultDeckIds = JSON.parse(memoryData.hiddenDefaultDeckIds);
      }
    } catch (_) {}

    let customBooks = [];
    try {
      if (customBooksRow?.books) customBooks = JSON.parse(customBooksRow.books);
    } catch (_) {}

    res.json({
      groups: groups.map((g) => toGroupResponse(g)),
      cards: cards.map((c) => toCardResponse(c)),
      selectedGroupId: prefs?.selectedGroupId ?? null,
      memoryDecks,
      hiddenDefaultDeckIds,
      customBooks,
      readerTheme: prefs?.readerTheme ?? 'light',
    });
  } catch (e) {
    next(e);
  }
});

// POST /api/sync/import — importação em massa (grupos + cards) para usuário logado
// body: { mode: 'replace' | 'merge', groups: [{ name }], cards: [{ groupIndex, portuguesePhrase, englishPhrase, direction?, imageUrl?, tips? }] }
// groupIndex = índice em groups[]; retorna { groups, cards } no formato do sync
router.post('/import', async (req, res, next) => {
  try {
    if (!isPremiumUser(req.user)) {
      return res.status(403).json({
        error: 'Importação disponível apenas para assinantes. Faça upgrade no menu Conta.',
        code: 'IMPORT_PREMIUM_ONLY',
      });
    }
    const userId = req.user.id;
    const { mode = 'replace', groups = [], cards = [] } = req.body;
    if (!Array.isArray(groups) || !Array.isArray(cards)) {
      return res.status(400).json({ error: 'groups e cards devem ser arrays' });
    }
    const nextReview = new Date();

    if (mode === 'replace') {
      await prisma.group.deleteMany({ where: { userId } });
    }

    const createdGroups = [];
    for (const g of groups) {
      const name = g?.name && String(g.name).trim();
      if (!name) continue;
      const row = await prisma.group.create({
        data: { name, userId },
      });
      createdGroups.push(row);
    }

    const createdCards = [];
    for (const c of cards) {
      const groupIndex = Number(c?.groupIndex);
      if (groupIndex < 0 || groupIndex >= createdGroups.length) continue;
      const groupId = createdGroups[groupIndex].id;
      const portuguesePhrase = String(c?.portuguesePhrase ?? '').trim();
      const englishPhrase = String(c?.englishPhrase ?? '').trim();
      if (!portuguesePhrase || !englishPhrase) continue;
      const direction = c?.direction === 'en-pt' ? 'en-pt' : 'pt-en';
      const row = await prisma.card.create({
        data: {
          groupId,
          userId,
          portuguesePhrase,
          englishPhrase,
          direction,
          level: 1,
          nextReview,
          imageUrl: c?.imageUrl?.trim() || null,
          tips: c?.tips?.trim() || null,
        },
      });
      createdCards.push(row);
    }

    res.status(201).json({
      groups: createdGroups.map((g) => toGroupResponse(g)),
      cards: createdCards.map((c) => toCardResponse(c)),
    });
  } catch (e) {
    next(e);
  }
});

export default router;
