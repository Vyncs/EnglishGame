import { Router } from 'express';
import prisma from '../db.js';
import { authMiddleware } from '../middleware/auth.js';
import { generateCoachReply, streamCoachReply } from '../services/aiService.js';
import { ALLOWED_LEVELS, ALLOWED_MODES } from '../services/coachPrompt.js';
import {
  synthesizeSpeech,
  synthesizeSpeechWithTimestamps,
  transcribeAudio,
} from '../services/voiceService.js';
import { mapAlignmentToVisemes } from '../services/visemeMapper.js';
import { isPremiumUser, FREE_COACH_DAILY_MESSAGES, todayDayKeyUTC } from '../utils/subscription.js';
import {
  ensureCoachMemory,
  buildMemorySummary,
  maybeAnalyzeMemoryInBackground,
} from '../services/memoryAnalyzer.js';

const router = Router();
router.use(authMiddleware);

// Limite de payload para áudios (Whisper aceita até 25MB).
const MAX_AUDIO_BYTES = 8 * 1024 * 1024; // 8MB — suficiente p/ ~5min webm/opus

// Rate-limit independente para chamadas de voz (mais permissivo que chat).
const VOICE_RATE_MAX = 20;
const VOICE_RATE_WINDOW_MS = 60_000;
const voiceBuckets = new Map();
function checkVoiceRateLimit(userId) {
  const now = Date.now();
  const arr = voiceBuckets.get(userId) || [];
  const recent = arr.filter((t) => now - t < VOICE_RATE_WINDOW_MS);
  if (recent.length >= VOICE_RATE_MAX) return false;
  recent.push(now);
  voiceBuckets.set(userId, recent);
  return true;
}

const MAX_MESSAGE_LENGTH = 1500;

// ---- Rate limit simples (memória) — 10 mensagens / 60s por usuário.
const RATE_LIMIT_MAX = 10;
const RATE_LIMIT_WINDOW_MS = 60_000;
const userBuckets = new Map(); // userId -> number[] timestamps

function checkRateLimit(userId) {
  const now = Date.now();
  const arr = userBuckets.get(userId) || [];
  const recent = arr.filter((t) => now - t < RATE_LIMIT_WINDOW_MS);
  if (recent.length >= RATE_LIMIT_MAX) {
    return false;
  }
  recent.push(now);
  userBuckets.set(userId, recent);
  return true;
}

// Helpers
function toMessageResponse(m) {
  return {
    id: m.id,
    role: m.role,
    content: m.content,
    correction: m.correction,
    explanation: m.explanation,
    naturalExample: m.naturalExample,
    nextQuestion: m.nextQuestion,
    createdAt: m.createdAt.getTime(),
  };
}

function toConversationResponse(c, includeMessages = false) {
  const base = {
    id: c.id,
    title: c.title,
    level: c.level,
    mode: c.mode,
    scoreGrammar: c.scoreGrammar,
    scoreVocabulary: c.scoreVocabulary,
    scoreFluency: c.scoreFluency,
    scorePronunciation: c.scorePronunciation,
    createdAt: c.createdAt.getTime(),
    updatedAt: c.updatedAt.getTime(),
  };
  if (includeMessages && c.messages) {
    base.messages = c.messages.map(toMessageResponse);
  }
  return base;
}

// GET /api/english-coach/conversations
router.get('/conversations', async (req, res, next) => {
  try {
    const list = await prisma.englishCoachConversation.findMany({
      where: { userId: req.user.id },
      orderBy: { updatedAt: 'desc' },
    });
    res.json(list.map((c) => toConversationResponse(c)));
  } catch (e) {
    next(e);
  }
});

// GET /api/english-coach/conversations/:id
router.get('/conversations/:id', async (req, res, next) => {
  try {
    const conv = await prisma.englishCoachConversation.findFirst({
      where: { id: req.params.id, userId: req.user.id },
      include: { messages: { orderBy: { createdAt: 'asc' } } },
    });
    if (!conv) return res.status(404).json({ error: 'Conversa não encontrada' });
    res.json(toConversationResponse(conv, true));
  } catch (e) {
    next(e);
  }
});

// DELETE /api/english-coach/conversations/:id
router.delete('/conversations/:id', async (req, res, next) => {
  try {
    const conv = await prisma.englishCoachConversation.findFirst({
      where: { id: req.params.id, userId: req.user.id },
    });
    if (!conv) return res.status(404).json({ error: 'Conversa não encontrada' });
    await prisma.englishCoachConversation.delete({ where: { id: conv.id } });
    res.status(204).send();
  } catch (e) {
    next(e);
  }
});

// POST /api/english-coach/chat
// Body: { message, level, mode, conversationId? }
router.post('/chat', async (req, res, next) => {
  try {
    const { message, level, mode, conversationId } = req.body || {};

    // Validação
    if (typeof message !== 'string' || !message.trim()) {
      return res.status(400).json({ error: 'Mensagem é obrigatória' });
    }
    if (message.length > MAX_MESSAGE_LENGTH) {
      return res.status(400).json({
        error: `Mensagem muito longa (máx ${MAX_MESSAGE_LENGTH} caracteres)`,
      });
    }
    const safeLevel = ALLOWED_LEVELS.includes(level) ? level : 'beginner';
    const safeMode = ALLOWED_MODES.includes(mode) ? mode : 'free';

    // Rate limit por minuto (anti-burst).
    if (!checkRateLimit(req.user.id)) {
      return res.status(429).json({
        error: 'Limite de mensagens atingido. Aguarde alguns segundos.',
        code: 'RATE_LIMIT_PER_MINUTE',
      });
    }

    // Cota diária (free tier). Premium ('active' ou 'vip') é ilimitado.
    const isPremium = isPremiumUser(req.user);
    let usageRemaining = null;
    let usageLimit = null;
    if (!isPremium) {
      const dayKey = todayDayKeyUTC();
      const usage = await prisma.englishCoachUsage.upsert({
        where: { userId_dayKey: { userId: req.user.id, dayKey } },
        update: {},
        create: { userId: req.user.id, dayKey, count: 0 },
        select: { count: true },
      });
      if (usage.count >= FREE_COACH_DAILY_MESSAGES) {
        return res.status(429).json({
          error: `Limite diário do plano gratuito atingido (${FREE_COACH_DAILY_MESSAGES} mensagens/dia). Assine o Premium para uso ilimitado.`,
          code: 'COACH_DAILY_LIMIT',
          limit: FREE_COACH_DAILY_MESSAGES,
          used: usage.count,
        });
      }
      usageLimit = FREE_COACH_DAILY_MESSAGES;
      usageRemaining = FREE_COACH_DAILY_MESSAGES - usage.count - 1; // após esta msg
    }

    // Pega ou cria conversa
    let conversation = null;
    if (conversationId) {
      conversation = await prisma.englishCoachConversation.findFirst({
        where: { id: conversationId, userId: req.user.id },
        include: { messages: { orderBy: { createdAt: 'asc' } } },
      });
      if (!conversation) {
        return res.status(404).json({ error: 'Conversa não encontrada' });
      }
      // Se o aluno mudou level/mode no front, atualiza no servidor.
      if (conversation.level !== safeLevel || conversation.mode !== safeMode) {
        conversation = await prisma.englishCoachConversation.update({
          where: { id: conversation.id },
          data: { level: safeLevel, mode: safeMode },
          include: { messages: { orderBy: { createdAt: 'asc' } } },
        });
      }
    } else {
      conversation = await prisma.englishCoachConversation.create({
        data: {
          userId: req.user.id,
          level: safeLevel,
          mode: safeMode,
          title: message.slice(0, 60),
        },
        include: { messages: true },
      });
    }

    // Monta histórico (só role/content)
    const history = (conversation.messages || []).map((m) => ({
      role: m.role,
      content: m.content,
    }));

    // Lê memória pedagógica (cria silenciosamente na 1ª chamada).
    // Falha aqui é não-fatal: tutor responde sem contexto persistente.
    let memorySummary = null;
    try {
      const memory = await ensureCoachMemory(req.user.id);
      memorySummary = buildMemorySummary(memory);
    } catch (memErr) {
      console.error('[english-coach] read memory failed:', memErr);
    }

    // Persiste mensagem do usuário
    const userMsg = await prisma.englishCoachMessage.create({
      data: {
        conversationId: conversation.id,
        role: 'user',
        content: message.trim(),
      },
    });

    // Chama IA
    const aiReply = await generateCoachReply({
      level: safeLevel,
      mode: safeMode,
      history,
      userMessage: message.trim(),
      memorySummary,
    });

    // Persiste resposta do assistente
    const assistantMsg = await prisma.englishCoachMessage.create({
      data: {
        conversationId: conversation.id,
        role: 'assistant',
        content: aiReply.reply,
        correction: aiReply.correction,
        explanation: aiReply.explanation,
        naturalExample: aiReply.naturalExample,
        nextQuestion: aiReply.nextQuestion,
      },
    });

    // Atualiza updatedAt da conversa (e título se ainda não houver)
    await prisma.englishCoachConversation.update({
      where: { id: conversation.id },
      data: {
        updatedAt: new Date(),
        title: conversation.title || message.slice(0, 60),
      },
    });

    // Incrementa a cota diária (free apenas) DEPOIS do sucesso da IA —
    // se a IA falhou, não consome cota do usuário.
    if (!isPremium) {
      const dayKey = todayDayKeyUTC();
      await prisma.englishCoachUsage.update({
        where: { userId_dayKey: { userId: req.user.id, dayKey } },
        data: { count: { increment: 1 } },
      });
    }

    // Dispara análise pedagógica em background (fire-and-forget).
    // Roda apenas se threshold de mensagens foi atingido — ver memoryAnalyzer.
    maybeAnalyzeMemoryInBackground(req.user.id);

    res.json({
      conversationId: conversation.id,
      userMessage: toMessageResponse(userMsg),
      assistantMessage: toMessageResponse(assistantMsg),
      reply: aiReply.reply,
      correction: aiReply.correction,
      explanation: aiReply.explanation,
      naturalExample: aiReply.naturalExample,
      nextQuestion: aiReply.nextQuestion,
      // Cota diária (apenas free; premium recebe null)
      plan: isPremium ? 'premium' : 'free',
      usageLimit,
      usageRemaining,
    });
  } catch (e) {
    next(e);
  }
});

// ==========================================
// STREAMING SSE — POST /api/english-coach/chat/stream
// Body: { message, level, mode, conversationId? }
// Resposta: text/event-stream com eventos:
//   event: start  data: { conversationId, userMessageId, assistantMessageId, plan, usageLimit, usageRemaining }
//   event: token  data: { delta }                       (várias vezes)
//   event: meta   data: { correction, explanation, naturalExample, nextQuestion }
//   event: done   data: { reply }
//   event: error  data: { message }
// ==========================================
router.post('/chat/stream', async (req, res, next) => {
  try {
    const { message, level, mode, conversationId } = req.body || {};

    if (typeof message !== 'string' || !message.trim()) {
      return res.status(400).json({ error: 'Mensagem é obrigatória' });
    }
    if (message.length > MAX_MESSAGE_LENGTH) {
      return res.status(400).json({
        error: `Mensagem muito longa (máx ${MAX_MESSAGE_LENGTH} caracteres)`,
      });
    }
    const safeLevel = ALLOWED_LEVELS.includes(level) ? level : 'beginner';
    const safeMode = ALLOWED_MODES.includes(mode) ? mode : 'free';

    if (!checkRateLimit(req.user.id)) {
      return res.status(429).json({
        error: 'Limite de mensagens atingido. Aguarde alguns segundos.',
        code: 'RATE_LIMIT_PER_MINUTE',
      });
    }

    // Cota diária (mesma lógica do /chat).
    const isPremium = isPremiumUser(req.user);
    let usageRemaining = null;
    let usageLimit = null;
    if (!isPremium) {
      const dayKey = todayDayKeyUTC();
      const usage = await prisma.englishCoachUsage.upsert({
        where: { userId_dayKey: { userId: req.user.id, dayKey } },
        update: {},
        create: { userId: req.user.id, dayKey, count: 0 },
        select: { count: true },
      });
      if (usage.count >= FREE_COACH_DAILY_MESSAGES) {
        return res.status(429).json({
          error: `Limite diário do plano gratuito atingido (${FREE_COACH_DAILY_MESSAGES} mensagens/dia). Assine o Premium para uso ilimitado.`,
          code: 'COACH_DAILY_LIMIT',
          limit: FREE_COACH_DAILY_MESSAGES,
          used: usage.count,
        });
      }
      usageLimit = FREE_COACH_DAILY_MESSAGES;
      usageRemaining = FREE_COACH_DAILY_MESSAGES - usage.count - 1;
    }

    // ----- Carrega ou cria conversa -----
    let conversation = null;
    if (conversationId) {
      conversation = await prisma.englishCoachConversation.findFirst({
        where: { id: conversationId, userId: req.user.id },
        include: { messages: { orderBy: { createdAt: 'asc' } } },
      });
      if (!conversation) {
        return res.status(404).json({ error: 'Conversa não encontrada' });
      }
      if (conversation.level !== safeLevel || conversation.mode !== safeMode) {
        conversation = await prisma.englishCoachConversation.update({
          where: { id: conversation.id },
          data: { level: safeLevel, mode: safeMode },
          include: { messages: { orderBy: { createdAt: 'asc' } } },
        });
      }
    } else {
      conversation = await prisma.englishCoachConversation.create({
        data: {
          userId: req.user.id,
          level: safeLevel,
          mode: safeMode,
          title: message.slice(0, 60),
        },
        include: { messages: true },
      });
    }

    const history = (conversation.messages || []).map((m) => ({
      role: m.role,
      content: m.content,
    }));

    // Lê memória pedagógica antes do stream (não-fatal).
    let memorySummary = null;
    try {
      const memory = await ensureCoachMemory(req.user.id);
      memorySummary = buildMemorySummary(memory);
    } catch (memErr) {
      console.error('[english-coach] read memory failed:', memErr);
    }

    // Persiste user msg + placeholder do assistant ANTES do stream — assim o
    // cliente já recebe os IDs reais no evento `start`.
    const userMsg = await prisma.englishCoachMessage.create({
      data: {
        conversationId: conversation.id,
        role: 'user',
        content: message.trim(),
      },
    });
    const assistantPlaceholder = await prisma.englishCoachMessage.create({
      data: {
        conversationId: conversation.id,
        role: 'assistant',
        content: '',
      },
    });

    // ----- Abre o stream SSE -----
    res.set({
      'Content-Type': 'text/event-stream; charset=utf-8',
      'Cache-Control': 'no-cache, no-transform',
      Connection: 'keep-alive',
      // Desativa buffer do nginx/proxies reversos.
      'X-Accel-Buffering': 'no',
    });
    res.flushHeaders?.();

    const sseSend = (event, data) => {
      try {
        res.write(`event: ${event}\n`);
        res.write(`data: ${JSON.stringify(data)}\n\n`);
      } catch {
        /* conexão fechada */
      }
    };

    // Heartbeat a cada 15s — mantém conexão viva atrás de proxies.
    const heartbeat = setInterval(() => {
      try { res.write(':heartbeat\n\n'); } catch { /* fechada */ }
    }, 15_000);

    let clientClosed = false;
    req.on('close', () => { clientClosed = true; clearInterval(heartbeat); });

    sseSend('start', {
      conversationId: conversation.id,
      userMessageId: userMsg.id,
      assistantMessageId: assistantPlaceholder.id,
      plan: isPremium ? 'premium' : 'free',
      usageLimit,
      usageRemaining,
    });

    // ----- Chama IA streaming -----
    let finalReply = null;
    try {
      finalReply = await streamCoachReply(
        {
          level: safeLevel,
          mode: safeMode,
          history,
          userMessage: message.trim(),
          memorySummary,
        },
        async (event) => {
          if (clientClosed) return;
          if (event.type === 'token') {
            sseSend('token', { delta: event.delta });
          } else if (event.type === 'meta') {
            sseSend('meta', {
              correction: event.correction,
              explanation: event.explanation,
              naturalExample: event.naturalExample,
              nextQuestion: event.nextQuestion,
            });
          } else if (event.type === 'done') {
            sseSend('done', { reply: event.reply });
          }
        }
      );
    } catch (err) {
      console.error('[english-coach] /chat/stream failed:', err);
      sseSend('error', { message: 'Falha ao gerar resposta' });
    }

    clearInterval(heartbeat);

    // ----- Persiste resposta final + incrementa cota só se sucedeu -----
    if (finalReply) {
      try {
        await prisma.englishCoachMessage.update({
          where: { id: assistantPlaceholder.id },
          data: {
            content: finalReply.reply,
            correction: finalReply.correction,
            explanation: finalReply.explanation,
            naturalExample: finalReply.naturalExample,
            nextQuestion: finalReply.nextQuestion,
          },
        });
        await prisma.englishCoachConversation.update({
          where: { id: conversation.id },
          data: {
            updatedAt: new Date(),
            title: conversation.title || message.slice(0, 60),
          },
        });
        if (!isPremium) {
          const dayKey = todayDayKeyUTC();
          await prisma.englishCoachUsage.update({
            where: { userId_dayKey: { userId: req.user.id, dayKey } },
            data: { count: { increment: 1 } },
          });
        }

        // Dispara análise pedagógica em background — roda apenas se atingiu
        // threshold de mensagens (ver memoryAnalyzer.shouldAnalyze).
        maybeAnalyzeMemoryInBackground(req.user.id);
      } catch (persistErr) {
        console.error('[english-coach] persist after stream failed:', persistErr);
      }
    } else {
      try {
        await prisma.englishCoachMessage.delete({ where: { id: assistantPlaceholder.id } });
      } catch { /* noop */ }
    }

    res.end();
  } catch (e) {
    next(e);
  }
});

// ==========================================
// VOZ — TTS (ElevenLabs) e STT (OpenAI Whisper)
// ==========================================

// GET /api/english-coach/voice/status
// Permite o frontend saber se deve mostrar botões de voz server-side,
// e se está pronto para lip sync viseme-based (ttsWithTimestamps).
router.get('/voice/status', (req, res) => {
  res.json({
    tts: !!process.env.ELEVENLABS_API_KEY,
    stt: !!process.env.OPENAI_API_KEY,
    // True quando POST /voice/tts-with-timestamps está disponível.
    // ElevenLabs é o único provider que retorna timestamps por caractere,
    // então depende da mesma chave.
    ttsWithTimestamps: !!process.env.ELEVENLABS_API_KEY,
  });
});

// POST /api/english-coach/voice/tts
// Body: { text, slow? }
// Retorna áudio MP3 (Content-Type: audio/mpeg) — ideal para <audio src=blob>.
router.post('/voice/tts', async (req, res, next) => {
  try {
    const { text, slow } = req.body || {};
    if (!checkVoiceRateLimit(req.user.id)) {
      return res.status(429).json({ error: 'Muitas requisições de voz. Aguarde.' });
    }

    const audioBuffer = await synthesizeSpeech(text, { slow: !!slow });

    res.set('Content-Type', 'audio/mpeg');
    res.set('Cache-Control', 'private, max-age=600');
    res.send(audioBuffer);
  } catch (e) {
    if (e.code === 'TTS_NOT_CONFIGURED') {
      return res.status(501).json({ error: e.message, code: e.code });
    }
    next(e);
  }
});

// POST /api/english-coach/voice/tts-with-timestamps
// Body: { text, slow? }
// Retorna JSON: { audioBase64, alignment, visemes | null }
//
// `audioBase64` é o mp3 codificado em base64 (uma única chamada HTTP entrega
// áudio + alinhamento). `alignment` traz timestamps por caractere — usado
// pelo driver de lip sync no frontend. `visemes` é null no MVP (Semana 1)
// e será preenchido quando o visemeMapper for implementado (Semana 3).
router.post('/voice/tts-with-timestamps', async (req, res, next) => {
  try {
    const { text, slow } = req.body || {};
    if (!checkVoiceRateLimit(req.user.id)) {
      return res.status(429).json({ error: 'Muitas requisições de voz. Aguarde.' });
    }

    const { audio, alignment } = await synthesizeSpeechWithTimestamps(text, { slow: !!slow });
    const visemes = mapAlignmentToVisemes(alignment); // null no MVP

    res.json({
      audioBase64: audio.toString('base64'),
      alignment,
      visemes,
    });
  } catch (e) {
    if (e.code === 'TTS_NOT_CONFIGURED') {
      return res.status(501).json({ error: e.message, code: e.code });
    }
    next(e);
  }
});

// POST /api/english-coach/voice/stt
// Multipart: campo "audio" (arquivo .webm/.mp3/.wav). Opcional: language=en|pt.
// Retorna { text }.
//
// Implementação manual de multipart (sem multer) — Express 5 expõe req como
// stream; coletamos o body bruto e separamos os boundaries.
router.post('/voice/stt', async (req, res, next) => {
  try {
    if (!checkVoiceRateLimit(req.user.id)) {
      return res.status(429).json({ error: 'Muitas requisições de voz. Aguarde.' });
    }
    const contentType = req.headers['content-type'] || '';
    if (!contentType.startsWith('multipart/form-data')) {
      return res.status(400).json({ error: 'Envie como multipart/form-data com campo "audio"' });
    }

    // Coleta do body bruto
    const chunks = [];
    let total = 0;
    for await (const chunk of req) {
      total += chunk.length;
      if (total > MAX_AUDIO_BYTES) {
        return res.status(413).json({ error: 'Áudio muito grande (máx 8MB)' });
      }
      chunks.push(chunk);
    }
    const raw = Buffer.concat(chunks);

    const boundaryMatch = contentType.match(/boundary=(.+)$/);
    if (!boundaryMatch) return res.status(400).json({ error: 'Boundary ausente' });
    const boundary = `--${boundaryMatch[1]}`;

    // Parser mínimo: pega a primeira parte que tem name="audio".
    const parts = splitBuffer(raw, Buffer.from(boundary));
    let audioBuf = null;
    let filename = 'audio.webm';
    let language = 'en';

    for (const part of parts) {
      if (!part.length || part.equals(Buffer.from('--\r\n'))) continue;
      const headerEnd = part.indexOf('\r\n\r\n');
      if (headerEnd === -1) continue;
      const headers = part.slice(0, headerEnd).toString('utf8');
      const body = part.slice(headerEnd + 4, part.length - 2); // remove \r\n final

      const nameMatch = headers.match(/name="([^"]+)"/);
      const fileMatch = headers.match(/filename="([^"]+)"/);
      const name = nameMatch?.[1];

      if (name === 'audio' && fileMatch) {
        audioBuf = body;
        filename = fileMatch[1] || filename;
      } else if (name === 'language') {
        language = body.toString('utf8').trim() || language;
      }
    }

    if (!audioBuf || !audioBuf.length) {
      return res.status(400).json({ error: 'Campo "audio" ausente' });
    }

    const text = await transcribeAudio(audioBuf, { filename, language });
    res.json({ text });
  } catch (e) {
    if (e.code === 'STT_NOT_CONFIGURED') {
      return res.status(501).json({ error: e.message, code: e.code });
    }
    next(e);
  }
});

/** Divide um buffer em partes usando um separator buffer (boundary multipart). */
function splitBuffer(buf, sep) {
  const parts = [];
  let start = 0;
  while (true) {
    const idx = buf.indexOf(sep, start);
    if (idx === -1) break;
    if (start > 0) parts.push(buf.slice(start, idx - 2)); // -2 para tirar \r\n
    start = idx + sep.length + 2; // +2 para pular \r\n após boundary
  }
  return parts;
}

export default router;
