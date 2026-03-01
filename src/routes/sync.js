// Uma única rota para carregar todos os dados do usuário (evita várias requisições no load)
import { Router } from 'express';
import prisma from '../db.js';
import { authMiddleware } from '../middleware/auth.js';
import { toGroupResponse } from './groups.js';
import { toCardResponse } from './cards.js';

const router = Router();
router.use(authMiddleware);

// GET /api/sync — retorna groups, cards, memoryDecks, hiddenDefaultDeckIds, customBooks, preferences
router.get('/', async (req, res) => {
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
    console.error(e);
    res.status(500).json({ error: 'Erro ao sincronizar dados' });
  }
});

export default router;
