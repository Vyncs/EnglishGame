import { Router } from 'express';
import prisma from '../db.js';
import { authMiddleware } from '../middleware/auth.js';

const router = Router();
router.use(authMiddleware);

// GET /api/preferences
router.get('/', async (req, res, next) => {
  try {
    const prefs = await prisma.userPreferences.findUnique({
      where: { userId: req.user.id },
    });
    res.json({
      selectedGroupId: prefs?.selectedGroupId ?? null,
      readerTheme: prefs?.readerTheme ?? 'light',
    });
  } catch (e) {
    next(e);
  }
});

// PUT /api/preferences
router.put('/', async (req, res, next) => {
  try {
    const { selectedGroupId, readerTheme } = req.body;
    const data = {};
    if (selectedGroupId !== undefined) data.selectedGroupId = selectedGroupId === null ? null : String(selectedGroupId);
    if (readerTheme !== undefined) data.readerTheme = ['light', 'dark', 'sepia'].includes(readerTheme) ? readerTheme : 'light';
    await prisma.userPreferences.upsert({
      where: { userId: req.user.id },
      create: { userId: req.user.id, ...data },
      update: data,
    });
    res.json({ ok: true });
  } catch (e) {
    next(e);
  }
});

export default router;
