// Serviço de voz: TTS (ElevenLabs) e STT (OpenAI Whisper).
// Ambos são opcionais — se a chave não existir, o frontend cai no Web Speech API
// (que já está implementado com useSpeech / useSpeechRecognition).

const ELEVENLABS_BASE = 'https://api.elevenlabs.io/v1';
// Rachel — voz feminina clara e didática, ótima para ensino.
const DEFAULT_VOICE_ID = process.env.ELEVENLABS_VOICE_ID || '21m00Tcm4TlvDq8ikWAM';
const DEFAULT_VOICE_MODEL = process.env.ELEVENLABS_MODEL || 'eleven_multilingual_v2';

/**
 * Sintetiza fala via ElevenLabs e devolve um Buffer com mp3.
 *
 * Por que streaming: a Free tier suporta o endpoint /stream e a percepção de
 * latência cai bastante. Mas o cliente atual reproduz via <audio> com src blob,
 * então retornamos buffer completo (mp3) — ainda rápido para frases curtas.
 *
 * @param {string} text
 * @param {{ voiceId?: string, slow?: boolean }} opts
 * @returns {Promise<Buffer>} mp3
 */
export async function synthesizeSpeech(text, { voiceId, slow = false } = {}) {
  const apiKey = process.env.ELEVENLABS_API_KEY;
  if (!apiKey) {
    const e = new Error('TTS não configurado no servidor');
    e.code = 'TTS_NOT_CONFIGURED';
    e.status = 501;
    throw e;
  }
  if (!text || typeof text !== 'string') {
    const e = new Error('Texto obrigatório');
    e.status = 400;
    throw e;
  }
  if (text.length > 800) {
    const e = new Error('Texto muito longo para TTS (máx 800 caracteres)');
    e.status = 400;
    throw e;
  }

  // ElevenLabs voice_settings: stability/similarity_boost.
  // 'slow' não é nativo; controlamos velocidade no client (audio.playbackRate).
  const url = `${ELEVENLABS_BASE}/text-to-speech/${voiceId || DEFAULT_VOICE_ID}`;
  const res = await fetch(url, {
    method: 'POST',
    headers: {
      'xi-api-key': apiKey,
      'Content-Type': 'application/json',
      Accept: 'audio/mpeg',
    },
    body: JSON.stringify({
      text,
      model_id: DEFAULT_VOICE_MODEL,
      voice_settings: {
        stability: 0.5,
        similarity_boost: 0.75,
        style: slow ? 0 : 0.2, // slow → mais neutro, menos expressivo
        use_speaker_boost: true,
      },
    }),
  });

  if (!res.ok) {
    const errBody = await res.text().catch(() => '');
    console.error('[english-coach] ElevenLabs TTS error', res.status, errBody);
    const e = new Error(
      res.status === 401
        ? 'Chave do ElevenLabs inválida'
        : res.status === 429
          ? 'Limite mensal do ElevenLabs atingido'
          : 'Falha ao sintetizar fala'
    );
    e.status = res.status === 401 ? 502 : res.status;
    throw e;
  }

  const arrayBuf = await res.arrayBuffer();
  return Buffer.from(arrayBuf);
}

/**
 * Sintetiza fala COM timestamps por caractere — base do lip sync futuro.
 *
 * ElevenLabs retorna JSON com:
 *   - audio_base64: mp3 já codificado em base64
 *   - alignment: { characters[], character_start_times_seconds[], character_end_times_seconds[] }
 *
 * O contrato de saída desta função é normalizado para camelCase (TtsAlignment
 * no frontend). O array de visemas é deixado para o visemeMapper.
 *
 * @param {string} text
 * @param {{ voiceId?: string, slow?: boolean }} opts
 * @returns {Promise<{ audio: Buffer, alignment: {
 *   characters: string[],
 *   characterStartTimesSeconds: number[],
 *   characterEndTimesSeconds: number[],
 * } }>}
 */
export async function synthesizeSpeechWithTimestamps(text, { voiceId, slow = false } = {}) {
  const apiKey = process.env.ELEVENLABS_API_KEY;
  if (!apiKey) {
    const e = new Error('TTS com timestamps não configurado no servidor');
    e.code = 'TTS_NOT_CONFIGURED';
    e.status = 501;
    throw e;
  }
  if (!text || typeof text !== 'string') {
    const e = new Error('Texto obrigatório');
    e.status = 400;
    throw e;
  }
  if (text.length > 800) {
    const e = new Error('Texto muito longo para TTS (máx 800 caracteres)');
    e.status = 400;
    throw e;
  }

  const url = `${ELEVENLABS_BASE}/text-to-speech/${voiceId || DEFAULT_VOICE_ID}/with-timestamps`;
  const res = await fetch(url, {
    method: 'POST',
    headers: {
      'xi-api-key': apiKey,
      'Content-Type': 'application/json',
      Accept: 'application/json',
    },
    body: JSON.stringify({
      text,
      model_id: DEFAULT_VOICE_MODEL,
      voice_settings: {
        stability: 0.5,
        similarity_boost: 0.75,
        style: slow ? 0 : 0.2,
        use_speaker_boost: true,
      },
    }),
  });

  if (!res.ok) {
    const errBody = await res.text().catch(() => '');
    console.error('[english-coach] ElevenLabs TTS+timestamps error', res.status, errBody);
    const e = new Error(
      res.status === 401
        ? 'Chave do ElevenLabs inválida'
        : res.status === 429
          ? 'Limite mensal do ElevenLabs atingido'
          : 'Falha ao sintetizar fala com timestamps'
    );
    e.status = res.status === 401 ? 502 : res.status;
    throw e;
  }

  const data = await res.json();
  if (!data?.audio_base64 || !data?.alignment) {
    const e = new Error('Resposta inválida do ElevenLabs');
    e.status = 502;
    throw e;
  }

  return {
    audio: Buffer.from(data.audio_base64, 'base64'),
    alignment: {
      characters: data.alignment.characters || [],
      characterStartTimesSeconds: data.alignment.character_start_times_seconds || [],
      characterEndTimesSeconds: data.alignment.character_end_times_seconds || [],
    },
  };
}

/**
 * Transcreve áudio via OpenAI Whisper (modelo whisper-1).
 * Aceita um Buffer com webm/mp3/wav/m4a etc — o Whisper detecta sozinho.
 *
 * Cliente envia multipart já feito (FormData). Esta função recebe o
 * Buffer + filename e monta o upload server→server.
 *
 * @param {Buffer} buffer
 * @param {{ filename?: string, language?: string }} opts
 * @returns {Promise<string>} transcrição
 */
export async function transcribeAudio(buffer, { filename = 'audio.webm', language = 'en' } = {}) {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) {
    const e = new Error('STT não configurado no servidor');
    e.code = 'STT_NOT_CONFIGURED';
    e.status = 501;
    throw e;
  }

  // FormData nativo do Node 18+.
  const form = new FormData();
  const blob = new Blob([buffer]);
  form.append('file', blob, filename);
  form.append('model', 'whisper-1');
  if (language) form.append('language', language);
  form.append('response_format', 'json');

  const res = await fetch('https://api.openai.com/v1/audio/transcriptions', {
    method: 'POST',
    headers: { Authorization: `Bearer ${apiKey}` },
    body: form,
  });

  if (!res.ok) {
    const errBody = await res.text().catch(() => '');
    console.error('[english-coach] Whisper STT error', res.status, errBody);
    const e = new Error('Falha ao transcrever áudio');
    e.status = res.status;
    throw e;
  }

  const data = await res.json();
  return data?.text || '';
}
