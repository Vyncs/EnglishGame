// Serviço de IA para o English Coach.
//
// Suporta DOIS providers, com seleção automática por chave configurada:
//   1. Google Gemini (`GEMINI_API_KEY`)  — free tier real (1500 req/dia)
//   2. OpenAI       (`OPENAI_API_KEY`)   — pago, qualidade premium
//
// Se ambos estiverem definidos, prioriza Gemini (free). Se nenhum, cai num
// fallback amigável que mantém o contrato de UI funcionando.
//
// Sem SDK extra — fetch nativo do Node 18+.

import { buildSystemPrompt, buildFallbackReply } from './coachPrompt.js';

const OPENAI_URL = 'https://api.openai.com/v1/chat/completions';
const OPENAI_MODEL = process.env.OPENAI_MODEL || 'gpt-4o-mini';

// Gemini API base. 2.5-flash é o modelo com free tier ativo em 2026
// (2.0-flash teve free tier descontinuado em vários projetos novos).
const GEMINI_BASE = 'https://generativelanguage.googleapis.com/v1beta/models';
const GEMINI_MODEL = process.env.GEMINI_MODEL || 'gemini-2.5-flash';

const MAX_HISTORY = 12; // últimas N mensagens (user+assistant) enviadas como contexto

/**
 * @typedef {{ role: 'user' | 'assistant', content: string }} ChatMsg
 * @typedef {{
 *   reply: string,
 *   correction: string | null,
 *   explanation: string | null,
 *   naturalExample: string | null,
 *   nextQuestion: string
 * }} CoachReply
 *
 * @typedef {(
 *   | { type: 'token', delta: string }
 *   | { type: 'meta', correction: string|null, explanation: string|null, naturalExample: string|null, nextQuestion: string }
 *   | { type: 'done', reply: string }
 *   | { type: 'error', message: string }
 * )} StreamEvent
 *
 * @typedef {'gemini' | 'openai' | null} AIProvider
 */

/** Retorna o provider ativo. Gemini tem prioridade (free). */
function selectProvider() {
  if (process.env.GEMINI_API_KEY) return 'gemini';
  if (process.env.OPENAI_API_KEY) return 'openai';
  return null;
}

/**
 * Gera a resposta do coach (não-streaming).
 * @param {{ level: string, mode: string, history: ChatMsg[], userMessage: string, memorySummary?: string | null }} params
 * @returns {Promise<CoachReply>}
 */
export async function generateCoachReply(params) {
  const provider = selectProvider();
  if (!provider) {
    console.warn(
      '[english-coach] Nenhum provider de IA configurado. Defina GEMINI_API_KEY (free) ou OPENAI_API_KEY no .env.'
    );
    return buildFallbackReply(params.level);
  }
  try {
    if (provider === 'gemini') return await generateWithGemini(params);
    return await generateWithOpenAI(params);
  } catch (err) {
    console.error(`[english-coach] generateCoachReply (${provider}) failed:`, err);
    return buildFallbackReply(params.level);
  }
}

/**
 * Gera resposta em streaming (SSE).
 * @param {{ level: string, mode: string, history: ChatMsg[], userMessage: string, memorySummary?: string | null }} params
 * @param {(event: StreamEvent) => void | Promise<void>} onEvent
 * @returns {Promise<CoachReply>}
 */
export async function streamCoachReply(params, onEvent) {
  const provider = selectProvider();
  if (!provider) {
    const fb = buildFallbackReply(params.level);
    await emitFallbackAsStream(fb, onEvent);
    return fb;
  }
  try {
    if (provider === 'gemini') return await streamWithGemini(params, onEvent);
    return await streamWithOpenAI(params, onEvent);
  } catch (err) {
    console.error(`[english-coach] streamCoachReply (${provider}) failed:`, err);
    const fb = buildFallbackReply(params.level);
    await emitFallbackAsStream(fb, onEvent);
    return fb;
  }
}

// ==========================================
// OpenAI provider
// ==========================================

async function generateWithOpenAI({ level, mode, history, userMessage, memorySummary = null }) {
  const apiKey = process.env.OPENAI_API_KEY;
  const trimmedHistory = (history || []).slice(-MAX_HISTORY);
  const systemPrompt = buildSystemPrompt(level, mode, memorySummary);

  const messages = [
    { role: 'system', content: systemPrompt },
    ...trimmedHistory.map((m) => ({ role: m.role, content: m.content })),
    { role: 'user', content: userMessage },
  ];

  const res = await fetch(OPENAI_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${apiKey}` },
    body: JSON.stringify({
      model: OPENAI_MODEL,
      messages,
      temperature: 0.7,
      max_tokens: 500,
      response_format: { type: 'json_object' },
    }),
  });

  if (!res.ok) {
    const errBody = await res.text().catch(() => '');
    console.error('[english-coach] OpenAI error', res.status, errBody);
    return buildFallbackReply(level);
  }

  const data = await res.json();
  const raw = data?.choices?.[0]?.message?.content;
  if (!raw) return buildFallbackReply(level);
  return parseCoachReply(raw, level);
}

async function streamWithOpenAI({ level, mode, history, userMessage, memorySummary = null }, onEvent) {
  const apiKey = process.env.OPENAI_API_KEY;
  const trimmedHistory = (history || []).slice(-MAX_HISTORY);
  const systemPrompt = buildSystemPrompt(level, mode, memorySummary);

  const messages = [
    { role: 'system', content: systemPrompt },
    ...trimmedHistory.map((m) => ({ role: m.role, content: m.content })),
    { role: 'user', content: userMessage },
  ];

  const res = await fetch(OPENAI_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${apiKey}` },
    body: JSON.stringify({
      model: OPENAI_MODEL,
      messages,
      temperature: 0.7,
      max_tokens: 500,
      response_format: { type: 'json_object' },
      stream: true,
    }),
  });

  if (!res.ok || !res.body) {
    const errBody = await res.text?.().catch(() => '');
    console.error('[english-coach] OpenAI stream error', res.status, errBody);
    const fb = buildFallbackReply(level);
    await emitFallbackAsStream(fb, onEvent);
    return fb;
  }

  return await consumeJsonStream(res.body, onEvent, level, openaiExtractDelta);
}

/** Extrai o delta de texto de um chunk SSE da OpenAI. */
function openaiExtractDelta(payload) {
  if (payload === '[DONE]') return null;
  let chunk;
  try {
    chunk = JSON.parse(payload);
  } catch {
    return null;
  }
  const delta = chunk?.choices?.[0]?.delta?.content;
  return typeof delta === 'string' && delta ? delta : null;
}

// ==========================================
// Gemini provider
// ==========================================

/**
 * Converte histórico estilo OpenAI {role:'user'|'assistant'} para o formato
 * Gemini {role:'user'|'model', parts:[{text}]}.
 */
function toGeminiContents(history, userMessage) {
  const contents = [];
  for (const m of history) {
    const role = m.role === 'assistant' ? 'model' : 'user';
    contents.push({ role, parts: [{ text: m.content }] });
  }
  contents.push({ role: 'user', parts: [{ text: userMessage }] });
  return contents;
}

async function generateWithGemini({ level, mode, history, userMessage, memorySummary = null }) {
  const apiKey = process.env.GEMINI_API_KEY;
  const trimmedHistory = (history || []).slice(-MAX_HISTORY);
  const systemPrompt = buildSystemPrompt(level, mode, memorySummary);

  const url = `${GEMINI_BASE}/${GEMINI_MODEL}:generateContent?key=${encodeURIComponent(apiKey)}`;
  const body = {
    contents: toGeminiContents(trimmedHistory, userMessage),
    systemInstruction: { parts: [{ text: systemPrompt }] },
    generationConfig: {
      temperature: 0.7,
      // Gemini 2.5 usa "thinking tokens" internos antes do output. Default
      // generoso (1500) cobre reply + meta JSON com folga.
      maxOutputTokens: 1500,
      responseMimeType: 'application/json',
    },
  };

  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });

  if (!res.ok) {
    const errBody = await res.text().catch(() => '');
    console.error('[english-coach] Gemini error', res.status, errBody);
    return buildFallbackReply(level);
  }

  const data = await res.json();
  const raw = data?.candidates?.[0]?.content?.parts?.[0]?.text;
  if (!raw) return buildFallbackReply(level);
  return parseCoachReply(raw, level);
}

async function streamWithGemini({ level, mode, history, userMessage, memorySummary = null }, onEvent) {
  const apiKey = process.env.GEMINI_API_KEY;
  const trimmedHistory = (history || []).slice(-MAX_HISTORY);
  const systemPrompt = buildSystemPrompt(level, mode, memorySummary);

  // alt=sse → response em formato Server-Sent Events compatível com nosso parser
  const url = `${GEMINI_BASE}/${GEMINI_MODEL}:streamGenerateContent?alt=sse&key=${encodeURIComponent(apiKey)}`;
  const body = {
    contents: toGeminiContents(trimmedHistory, userMessage),
    systemInstruction: { parts: [{ text: systemPrompt }] },
    generationConfig: {
      temperature: 0.7,
      maxOutputTokens: 1500,
      responseMimeType: 'application/json',
    },
  };

  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });

  if (!res.ok || !res.body) {
    const errBody = await res.text?.().catch(() => '');
    console.error('[english-coach] Gemini stream error', res.status, errBody);
    const fb = buildFallbackReply(level);
    await emitFallbackAsStream(fb, onEvent);
    return fb;
  }

  return await consumeJsonStream(res.body, onEvent, level, geminiExtractDelta);
}

/** Extrai o delta de texto de um chunk SSE do Gemini. */
function geminiExtractDelta(payload) {
  let chunk;
  try {
    chunk = JSON.parse(payload);
  } catch {
    return null;
  }
  const delta = chunk?.candidates?.[0]?.content?.parts?.[0]?.text;
  return typeof delta === 'string' && delta ? delta : null;
}

// ==========================================
// Shared streaming machinery
// ==========================================

/**
 * Consome um body SSE genérico e emite eventos de token/meta/done.
 * O extractor é específico do provider (lê `data: {...}` e devolve o delta de texto).
 *
 * Estratégia de streaming:
 * - Acumula JSON parcial vindo dos chunks
 * - Extrai campo "reply" via regex incremental — emite delta de texto
 * - Quando stream encerra, parseia JSON inteiro e emite meta + done
 *
 * @param {ReadableStream<Uint8Array>} body
 * @param {(event: StreamEvent) => void | Promise<void>} onEvent
 * @param {string} level
 * @param {(payload: string) => string | null} extractDelta
 * @returns {Promise<CoachReply>}
 */
async function consumeJsonStream(body, onEvent, level, extractDelta) {
  const reader = body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  let accumulatedJson = '';
  let lastEmittedReplyLen = 0;

  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });

      const lines = buffer.split('\n');
      buffer = lines.pop() || '';

      for (const line of lines) {
        const trimmed = line.trim();
        if (!trimmed.startsWith('data:')) continue;
        const payload = trimmed.slice(5).trim();
        if (!payload) continue;

        const delta = extractDelta(payload);
        if (!delta) continue;
        accumulatedJson += delta;

        const replyExtract = extractInProgressReply(accumulatedJson);
        if (replyExtract.length > lastEmittedReplyLen) {
          const tokenDelta = replyExtract.slice(lastEmittedReplyLen);
          lastEmittedReplyLen = replyExtract.length;
          await onEvent({ type: 'token', delta: tokenDelta });
        }
      }
    }
  } catch (err) {
    console.error('[english-coach] stream read error:', err);
  }

  const finalReply = parseCoachReply(accumulatedJson || '{}', level);

  await onEvent({
    type: 'meta',
    correction: finalReply.correction,
    explanation: finalReply.explanation,
    naturalExample: finalReply.naturalExample,
    nextQuestion: finalReply.nextQuestion,
  });
  await onEvent({ type: 'done', reply: finalReply.reply });

  return finalReply;
}

// ==========================================
// Shared parsing helpers
// ==========================================

/** Faz parse seguro do JSON do modelo. Se falhar, embala como texto puro. */
function parseCoachReply(raw, level) {
  let parsed;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return {
      reply: String(raw).trim(),
      correction: null,
      explanation: null,
      naturalExample: null,
      nextQuestion: 'Tell me more, please.',
    };
  }

  const fallback = buildFallbackReply(level);
  const reply = typeof parsed.reply === 'string' && parsed.reply.trim()
    ? parsed.reply.trim()
    : fallback.reply;
  const nextQuestion = typeof parsed.nextQuestion === 'string' && parsed.nextQuestion.trim()
    ? parsed.nextQuestion.trim()
    : fallback.nextQuestion;

  return {
    reply,
    correction: nullOrString(parsed.correction),
    explanation: nullOrString(parsed.explanation),
    naturalExample: nullOrString(parsed.naturalExample),
    nextQuestion,
  };
}

function nullOrString(v) {
  if (v == null) return null;
  if (typeof v !== 'string') return null;
  const t = v.trim();
  return t ? t : null;
}

/**
 * Extrai o conteúdo (já desescapado) do campo "reply" de um JSON parcial.
 * Aceita string aberta (sem aspas finais) — usado para streaming.
 */
function extractInProgressReply(buf) {
  const m = buf.match(/"reply"\s*:\s*"((?:\\.|[^"\\])*)("|$)/);
  if (!m) return '';
  let raw = m[1];
  if (raw.endsWith('\\') && !raw.endsWith('\\\\')) {
    raw = raw.slice(0, -1);
  }
  try {
    return JSON.parse(`"${raw}"`);
  } catch {
    return raw;
  }
}

/** Emite o reply do fallback como pseudo-stream — mantém contrato uniforme. */
async function emitFallbackAsStream(fb, onEvent) {
  const chunkSize = 18;
  for (let i = 0; i < fb.reply.length; i += chunkSize) {
    const delta = fb.reply.slice(i, i + chunkSize);
    await onEvent({ type: 'token', delta });
    await new Promise((r) => setTimeout(r, 28));
  }
  await onEvent({
    type: 'meta',
    correction: fb.correction,
    explanation: fb.explanation,
    naturalExample: fb.naturalExample,
    nextQuestion: fb.nextQuestion,
  });
  await onEvent({ type: 'done', reply: fb.reply });
}
