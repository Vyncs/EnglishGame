// Memory Analyzer — pega histórico recente de mensagens do user, chama IA
// para extrair perfil pedagógico estruturado, e atualiza CoachMemory.
//
// Princípios:
//   - Não armazena conversa bruta. Só análise agregada.
//   - Roda a cada N mensagens (default 10). Não bloqueia o caminho crítico
//     do chat — é chamado em background com try/catch tolerante.
//   - Provider auto-detectado: GEMINI_API_KEY (free) tem prioridade; cai pra
//     OPENAI_API_KEY se ausente; cai pra noop se nenhum.
//   - JSON-mode estruturado, parse seguro, fallbacks por campo.

import prisma from '../db.js';

const OPENAI_URL = 'https://api.openai.com/v1/chat/completions';
const GEMINI_BASE = 'https://generativelanguage.googleapis.com/v1beta/models';

// Modelos dedicados pra análise (podem ser mais baratos que o do chat).
const OPENAI_ANALYZER_MODEL =
  process.env.OPENAI_MEMORY_MODEL || process.env.OPENAI_MODEL || 'gpt-4o-mini';
const GEMINI_ANALYZER_MODEL =
  process.env.GEMINI_MEMORY_MODEL || process.env.GEMINI_MODEL || 'gemini-2.5-flash';

// Roda análise quando o user tem ao menos N mensagens novas desde a última.
const ANALYSIS_THRESHOLD = Number(process.env.COACH_MEMORY_ANALYZE_EVERY) || 10;

// Quantas mensagens recentes (cross-conversa) usamos como contexto da análise.
const ANALYSIS_WINDOW = 30;

const ALLOWED_CEFR = ['A1', 'A2', 'B1', 'B2', 'C1', 'C2'];

/**
 * Garante que existe uma row de CoachMemory para o user. Cria com defaults
 * se não houver. Sempre devolve a memória "viva" (objeto Prisma).
 *
 * @param {string} userId
 */
export async function ensureCoachMemory(userId) {
  const existing = await prisma.coachMemory.findUnique({ where: { userId } });
  if (existing) return existing;
  return prisma.coachMemory.create({ data: { userId } });
}

/**
 * Conta total de mensagens do user (cross-conversa). Usado para decidir
 * se deve disparar análise.
 */
export async function countUserMessages(userId) {
  return prisma.englishCoachMessage.count({
    where: { conversation: { userId } },
  });
}

/**
 * Versão "summary" da memória — string concisa pronta pra ser injetada
 * no system prompt. Mantém ≤ ~600 caracteres pra não inflar contexto.
 *
 * @param {object|null} memory CoachMemory (já com arrays parseados)
 * @returns {string|null}
 */
export function buildMemorySummary(memory) {
  if (!memory) return null;
  const parsed = parseMemoryFields(memory);
  const lines = [];

  lines.push(`CEFR estimate: ${parsed.cefrEstimate || 'A1'}`);
  if (parsed.progressionScore != null) {
    lines.push(`Progression: ${parsed.progressionScore}/100. Confidence: ${parsed.confidenceLevel}/100.`);
  }
  if (parsed.weakPoints.length) {
    lines.push(`Recurring weak points: ${parsed.weakPoints.slice(0, 5).join('; ')}.`);
  }
  if (parsed.strongPoints.length) {
    lines.push(`Strong points: ${parsed.strongPoints.slice(0, 3).join('; ')}.`);
  }
  if (parsed.pronunciationIssues.length) {
    lines.push(`Pronunciation issues: ${parsed.pronunciationIssues.slice(0, 3).join('; ')}.`);
  }
  if (parsed.topicsOfInterest.length) {
    lines.push(`Topics student likes: ${parsed.topicsOfInterest.slice(0, 5).join(', ')}.`);
  }
  if (parsed.studyGoals.length) {
    lines.push(`Goals: ${parsed.studyGoals.slice(0, 3).join('; ')}.`);
  }
  if (parsed.lastSessionInsights) {
    lines.push(`Last insight: ${parsed.lastSessionInsights}`);
  }
  if (parsed.conversationHistorySummary) {
    lines.push(`Where conversation left off: ${parsed.conversationHistorySummary}`);
  }
  return lines.join(' ').slice(0, 800);
}

/**
 * Helper: parseia os JSON-strings da memória em arrays/valores reais.
 * Tolera qualquer campo malformado (devolve [] / null).
 */
export function parseMemoryFields(memory) {
  return {
    weakPoints: safeJsonParseArray(memory.weakPoints),
    strongPoints: safeJsonParseArray(memory.strongPoints),
    vocabularySeen: safeJsonParseArray(memory.vocabularySeen),
    pronunciationIssues: safeJsonParseArray(memory.pronunciationIssues),
    topicsOfInterest: safeJsonParseArray(memory.topicsOfInterest),
    studyGoals: safeJsonParseArray(memory.studyGoals),
    preferredLearningStyle: memory.preferredLearningStyle || null,
    cefrEstimate: ALLOWED_CEFR.includes(memory.cefrEstimate)
      ? memory.cefrEstimate
      : 'A1',
    confidenceLevel: clamp(memory.confidenceLevel ?? 50, 0, 100),
    progressionScore: clamp(memory.progressionScore ?? 0, 0, 100),
    conversationHistorySummary: memory.conversationHistorySummary || null,
    lastSessionInsights: memory.lastSessionInsights || null,
    updatedAt: memory.updatedAt ?? null,
  };
}

/**
 * Decide se deve rodar análise agora. True quando:
 *   - threshold (10) mensagens novas desde a última análise, OU
 *   - memória existe mas nunca foi analisada e há ≥ 4 mensagens (warm start)
 *
 * @param {object} memory existing CoachMemory
 * @param {number} currentCount total de mensagens do user agora
 */
export function shouldAnalyze(memory, currentCount) {
  if (!memory) return false;
  const last = memory.lastAnalyzedMessageCount ?? 0;
  if (last === 0 && currentCount >= 4) return true;
  return currentCount - last >= ANALYSIS_THRESHOLD;
}

/**
 * Roda análise pedagógica via OpenAI e atualiza CoachMemory.
 * NÃO lança em caso de falha — apenas loga. É chamado em background.
 *
 * @param {string} userId
 * @returns {Promise<{ updated: boolean, reason?: string }>}
 */
export async function analyzeAndUpdateMemory(userId) {
  const provider = selectAnalyzerProvider();
  if (!provider) {
    return { updated: false, reason: 'no_api_key' };
  }

  try {
    const memory = await ensureCoachMemory(userId);
    const currentCount = await countUserMessages(userId);
    if (!shouldAnalyze(memory, currentCount)) {
      return { updated: false, reason: 'threshold_not_met' };
    }

    // Coleta últimas N mensagens cross-conversa.
    const recentMessages = await prisma.englishCoachMessage.findMany({
      where: { conversation: { userId } },
      orderBy: { createdAt: 'desc' },
      take: ANALYSIS_WINDOW,
      select: {
        role: true,
        content: true,
        correction: true,
        explanation: true,
      },
    });
    if (!recentMessages.length) {
      return { updated: false, reason: 'no_messages' };
    }
    recentMessages.reverse(); // ordem cronológica

    const transcript = recentMessages
      .map((m) => {
        const tag = m.role === 'user' ? 'STUDENT' : 'TUTOR';
        let line = `${tag}: ${m.content}`;
        if (m.role === 'assistant' && m.correction) {
          line += ` [correction: ${m.correction}]`;
        }
        return line;
      })
      .join('\n');

    const existingProfile = parseMemoryFields(memory);

    const systemPrompt = `You are a pedagogical analyst. Given a recent transcript between an English tutor and a Brazilian Portuguese-speaking student, plus the student's existing memory profile, output an UPDATED memory profile.

Rules:
- Be CONCISE. Each array max 8 items, prefer 3-5.
- weakPoints: specific recurring grammar/vocabulary errors (e.g. "uses 'have' instead of 'be' for age").
- strongPoints: things the student does well consistently.
- vocabularySeen: NEW words/phrases introduced in this window. Append to existing, drop oldest if > 30.
- pronunciationIssues: only if explicitly indicated by tutor or context (TH, R, vowels). Empty array if none.
- topicsOfInterest: themes the STUDENT brings up.
- studyGoals: short phrases. Keep prior goals unless contradicted.
- preferredLearningStyle: one of "conversational" | "structured" | "immersive" | "exam-focused" | "casual".
- cefrEstimate: A1|A2|B1|B2|C1|C2 based on output complexity.
- confidenceLevel: 0-100. Move at most ±10 from current per analysis.
- progressionScore: 0-100. Should trend UP over time, only go DOWN if clear regression.
- conversationHistorySummary: 2-3 sentences max about WHERE the most recent conversation left off.
- lastSessionInsights: 1-2 sentences with one ACTIONABLE insight for next session (e.g. "Drill past tense irregular verbs — student keeps regularizing them.").

Output ONLY a JSON object matching this exact schema (no markdown, no commentary):
{
  "weakPoints": string[],
  "strongPoints": string[],
  "vocabularySeen": string[],
  "pronunciationIssues": string[],
  "topicsOfInterest": string[],
  "studyGoals": string[],
  "preferredLearningStyle": string | null,
  "cefrEstimate": "A1"|"A2"|"B1"|"B2"|"C1"|"C2",
  "confidenceLevel": number,
  "progressionScore": number,
  "conversationHistorySummary": string,
  "lastSessionInsights": string
}`;

    const userPrompt = `EXISTING PROFILE:
${JSON.stringify(existingProfile, null, 2)}

RECENT TRANSCRIPT (last ${recentMessages.length} messages, oldest → newest):
${transcript}

Update and return the profile.`;

    const callResult = await callAnalyzerProvider(provider, systemPrompt, userPrompt);
    if (!callResult.ok) {
      return { updated: false, reason: callResult.reason };
    }
    const raw = callResult.text;
    if (!raw) return { updated: false, reason: 'empty_response' };

    const parsed = safeParseProfile(raw);
    if (!parsed) return { updated: false, reason: 'parse_failed' };

    // Persistência — campos JSON viram string.
    await prisma.coachMemory.update({
      where: { userId },
      data: {
        weakPoints: JSON.stringify(parsed.weakPoints),
        strongPoints: JSON.stringify(parsed.strongPoints),
        vocabularySeen: JSON.stringify(parsed.vocabularySeen),
        pronunciationIssues: JSON.stringify(parsed.pronunciationIssues),
        topicsOfInterest: JSON.stringify(parsed.topicsOfInterest),
        studyGoals: JSON.stringify(parsed.studyGoals),
        preferredLearningStyle: parsed.preferredLearningStyle,
        cefrEstimate: parsed.cefrEstimate,
        confidenceLevel: parsed.confidenceLevel,
        progressionScore: parsed.progressionScore,
        conversationHistorySummary: parsed.conversationHistorySummary,
        lastSessionInsights: parsed.lastSessionInsights,
        lastAnalyzedMessageCount: currentCount,
      },
    });

    return { updated: true };
  } catch (err) {
    console.error('[memoryAnalyzer] failed:', err);
    return { updated: false, reason: 'exception' };
  }
}

/**
 * Dispara análise em background (fire-and-forget). Usado pelos endpoints de
 * chat após persistir a resposta — não atrasa a resposta ao usuário.
 *
 * @param {string} userId
 */
export function maybeAnalyzeMemoryInBackground(userId) {
  // setImmediate evita microtask priority — deixa o response.send() do chat
  // sair primeiro. Em ambientes serverless o handler pode ser killed antes
  // de terminar — aceitável (próxima mensagem dispara de novo).
  setImmediate(() => {
    analyzeAndUpdateMemory(userId).catch((err) =>
      console.error('[memoryAnalyzer] bg failed:', err)
    );
  });
}

// ----- helpers privados -----

/**
 * Decide qual provider usar pra análise. Gemini tem prioridade (free tier).
 * @returns {'gemini' | 'openai' | null}
 */
function selectAnalyzerProvider() {
  if (process.env.GEMINI_API_KEY) return 'gemini';
  if (process.env.OPENAI_API_KEY) return 'openai';
  return null;
}

/**
 * Chama o provider escolhido pra análise. Devolve sempre o mesmo formato:
 *   { ok: true, text } | { ok: false, reason }
 *
 * @param {'gemini'|'openai'} provider
 * @param {string} systemPrompt
 * @param {string} userPrompt
 */
async function callAnalyzerProvider(provider, systemPrompt, userPrompt) {
  if (provider === 'gemini') {
    return callAnalyzerGemini(systemPrompt, userPrompt);
  }
  return callAnalyzerOpenAI(systemPrompt, userPrompt);
}

async function callAnalyzerOpenAI(systemPrompt, userPrompt) {
  const apiKey = process.env.OPENAI_API_KEY;
  const res = await fetch(OPENAI_URL, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      model: OPENAI_ANALYZER_MODEL,
      temperature: 0.2,
      max_tokens: 800,
      response_format: { type: 'json_object' },
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: userPrompt },
      ],
    }),
  });
  if (!res.ok) {
    const txt = await res.text().catch(() => '');
    console.error('[memoryAnalyzer] OpenAI error', res.status, txt);
    return { ok: false, reason: `openai_${res.status}` };
  }
  const data = await res.json();
  const text = data?.choices?.[0]?.message?.content;
  return { ok: true, text };
}

async function callAnalyzerGemini(systemPrompt, userPrompt) {
  const apiKey = process.env.GEMINI_API_KEY;
  const url = `${GEMINI_BASE}/${GEMINI_ANALYZER_MODEL}:generateContent?key=${encodeURIComponent(apiKey)}`;
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      contents: [{ role: 'user', parts: [{ text: userPrompt }] }],
      systemInstruction: { parts: [{ text: systemPrompt }] },
      generationConfig: {
        temperature: 0.2,
        // Análise gera JSON maior (perfil completo) + thinking tokens do 2.5
        maxOutputTokens: 2000,
        responseMimeType: 'application/json',
      },
    }),
  });
  if (!res.ok) {
    const txt = await res.text().catch(() => '');
    console.error('[memoryAnalyzer] Gemini error', res.status, txt);
    return { ok: false, reason: `gemini_${res.status}` };
  }
  const data = await res.json();
  const text = data?.candidates?.[0]?.content?.parts?.[0]?.text;
  return { ok: true, text };
}

function safeJsonParseArray(s) {
  if (!s) return [];
  try {
    const v = JSON.parse(s);
    return Array.isArray(v) ? v.filter((x) => typeof x === 'string') : [];
  } catch {
    return [];
  }
}

function safeParseProfile(raw) {
  let obj;
  try {
    obj = JSON.parse(raw);
  } catch {
    return null;
  }

  const cefr = ALLOWED_CEFR.includes(obj.cefrEstimate) ? obj.cefrEstimate : 'A1';
  const arr = (v) => (Array.isArray(v) ? v.filter((x) => typeof x === 'string').slice(0, 30) : []);

  return {
    weakPoints: arr(obj.weakPoints).slice(0, 8),
    strongPoints: arr(obj.strongPoints).slice(0, 8),
    vocabularySeen: arr(obj.vocabularySeen).slice(-30),
    pronunciationIssues: arr(obj.pronunciationIssues).slice(0, 8),
    topicsOfInterest: arr(obj.topicsOfInterest).slice(0, 8),
    studyGoals: arr(obj.studyGoals).slice(0, 6),
    preferredLearningStyle:
      typeof obj.preferredLearningStyle === 'string' ? obj.preferredLearningStyle : null,
    cefrEstimate: cefr,
    confidenceLevel: clamp(Number(obj.confidenceLevel) || 50, 0, 100),
    progressionScore: clamp(Number(obj.progressionScore) || 0, 0, 100),
    conversationHistorySummary:
      typeof obj.conversationHistorySummary === 'string'
        ? obj.conversationHistorySummary.slice(0, 500)
        : null,
    lastSessionInsights:
      typeof obj.lastSessionInsights === 'string'
        ? obj.lastSessionInsights.slice(0, 300)
        : null,
  };
}

function clamp(n, min, max) {
  return Math.min(max, Math.max(min, n));
}
