// Endpoints da memória pedagógica.
//
// Padrão da API:
//   GET  /api/english-coach/memory          → memória atual do user (cria com defaults se ainda não existir)
//   POST /api/english-coach/memory/analyze  → força análise agora (debug / admin / "Atualizar perfil")
//   DELETE /api/english-coach/memory        → reset (para testes / "Recomeçar do zero")
//
// Todos atrás de authMiddleware.

import { Router } from 'express';
import prisma from '../db.js';
import { authMiddleware } from '../middleware/auth.js';
import {
  ensureCoachMemory,
  parseMemoryFields,
  analyzeAndUpdateMemory,
} from '../services/memoryAnalyzer.js';

const router = Router();
router.use(authMiddleware);

// Mais conservador que o rate do chat — análise custa 1 chamada GPT.
const ANALYZE_RATE_MAX = 3;
const ANALYZE_RATE_WINDOW_MS = 5 * 60_000; // 5 min
const analyzeBuckets = new Map();
function checkAnalyzeRate(userId) {
  const now = Date.now();
  const arr = analyzeBuckets.get(userId) || [];
  const recent = arr.filter((t) => now - t < ANALYZE_RATE_WINDOW_MS);
  if (recent.length >= ANALYZE_RATE_MAX) return false;
  recent.push(now);
  analyzeBuckets.set(userId, recent);
  return true;
}

/** Serializa memória para o cliente — JSON-strings já parseados em arrays. */
function toMemoryResponse(memory) {
  const parsed = parseMemoryFields(memory);
  return {
    id: memory.id,
    weakPoints: parsed.weakPoints,
    strongPoints: parsed.strongPoints,
    vocabularySeen: parsed.vocabularySeen,
    pronunciationIssues: parsed.pronunciationIssues,
    topicsOfInterest: parsed.topicsOfInterest,
    studyGoals: parsed.studyGoals,
    preferredLearningStyle: parsed.preferredLearningStyle,
    cefrEstimate: parsed.cefrEstimate,
    confidenceLevel: parsed.confidenceLevel,
    progressionScore: parsed.progressionScore,
    conversationHistorySummary: parsed.conversationHistorySummary,
    lastSessionInsights: parsed.lastSessionInsights,
    lastAnalyzedMessageCount: memory.lastAnalyzedMessageCount ?? 0,
    updatedAt: memory.updatedAt?.getTime?.() ?? null,
    createdAt: memory.createdAt?.getTime?.() ?? null,
  };
}

// GET /api/english-coach/memory
router.get('/', async (req, res, next) => {
  try {
    const memory = await ensureCoachMemory(req.user.id);
    res.json(toMemoryResponse(memory));
  } catch (e) {
    next(e);
  }
});

// POST /api/english-coach/memory/analyze
// Body: {} (opcional)
// Força a análise mesmo que threshold não esteja atingido. Retorna a memória
// atualizada (ou a atual se a análise foi pulada/falhou).
router.post('/analyze', async (req, res, next) => {
  try {
    if (!checkAnalyzeRate(req.user.id)) {
      return res.status(429).json({
        error: 'Análise sob cooldown. Tente novamente em alguns minutos.',
        code: 'ANALYZE_RATE_LIMIT',
      });
    }
    const result = await analyzeAndUpdateMemory(req.user.id);
    const memory = await prisma.coachMemory.findUnique({
      where: { userId: req.user.id },
    });
    res.json({
      ...toMemoryResponse(memory || (await ensureCoachMemory(req.user.id))),
      analyzed: result.updated,
      reason: result.reason || null,
    });
  } catch (e) {
    next(e);
  }
});

// DELETE /api/english-coach/memory
// Reseta a memória do usuário (mantém row, zera campos). Útil para "Recomeçar".
router.delete('/', async (req, res, next) => {
  try {
    await prisma.coachMemory.upsert({
      where: { userId: req.user.id },
      create: { userId: req.user.id },
      update: {
        weakPoints: '[]',
        strongPoints: '[]',
        vocabularySeen: '[]',
        pronunciationIssues: '[]',
        topicsOfInterest: '[]',
        studyGoals: '[]',
        preferredLearningStyle: null,
        cefrEstimate: 'A1',
        confidenceLevel: 50,
        progressionScore: 0,
        conversationHistorySummary: null,
        lastSessionInsights: null,
        lastAnalyzedMessageCount: 0,
      },
    });
    const fresh = await ensureCoachMemory(req.user.id);
    res.json(toMemoryResponse(fresh));
  } catch (e) {
    next(e);
  }
});

export default router;
