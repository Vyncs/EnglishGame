// Viseme Mapper — converte alinhamento de caractere (ElevenLabs) em visemas
// prontos para consumir pelo driver de lip sync no frontend.
//
// Estratégia (Semana 3):
//   1. Para cada caractere, classifica num de 9 visemas via grafema.
//   2. Agrupa caracteres consecutivos do mesmo viseme num único keyframe
//      (reduz tamanho do array em ~3-4x e produz movimento mais natural).
//   3. Insere "silent" antes/depois de pausas (>120ms) — fecha a boca.
//   4. Co-articulação básica: bilabiais (M/B/P) inserem fechamento curto
//      antes mesmo da vogal seguinte, dando antecipação visual.
//
// Não faz phonema-real (custo alto). Grafema é "good enough" para lip sync
// percebido como natural — ~85-90% da qualidade de phonemes ML.

/** Conjunto reduzido de formas de boca — espelha VisemeShape no frontend. */
export const VISEME_SHAPES = ['AA', 'EH', 'IY', 'OH', 'OW', 'L', 'M', 'F', 'silent'];

/** Pausa mínima entre palavras (s) para inserir um silent keyframe. */
const SILENCE_GAP_THRESHOLD_S = 0.12;

/** Duração mínima de um viseme keyframe (s) — agrupar curtos em mesmo bloco. */
const MIN_KEYFRAME_DURATION_S = 0.04;

/** Anti-coarticulação: bilabiais antecipam fechamento em N segundos. */
const BILABIAL_LEAD_S = 0.05;

/**
 * @typedef {{
 *   characters: string[],
 *   characterStartTimesSeconds: number[],
 *   characterEndTimesSeconds: number[],
 * }} TtsAlignment
 *
 * @typedef {{ time: number, shape: string, weight: number }} Viseme
 */

/**
 * Mapeia alinhamento de caractere → array de visemas.
 *
 * @param {TtsAlignment | null | undefined} alignment
 * @returns {Viseme[] | null}
 */
export function mapAlignmentToVisemes(alignment) {
  if (
    !alignment ||
    !Array.isArray(alignment.characters) ||
    !alignment.characters.length ||
    !Array.isArray(alignment.characterStartTimesSeconds) ||
    !Array.isArray(alignment.characterEndTimesSeconds)
  ) {
    return null;
  }

  const { characters, characterStartTimesSeconds: starts, characterEndTimesSeconds: ends } =
    alignment;

  // 1. Classifica cada char num viseme bruto
  const raw = characters.map((c, i) => ({
    char: c,
    start: starts[i] ?? 0,
    end: ends[i] ?? starts[i] ?? 0,
    shape: classifyCharacterToViseme(c),
  }));

  if (!raw.length) return null;

  // 2. Agrupa runs consecutivos do mesmo viseme.
  // Resultado: blocos { shape, start, end }
  const blocks = [];
  let current = { shape: raw[0].shape, start: raw[0].start, end: raw[0].end };
  for (let i = 1; i < raw.length; i++) {
    const r = raw[i];
    // Se mesmo shape e contínuo (gap < threshold), estende.
    if (r.shape === current.shape && r.start - current.end < SILENCE_GAP_THRESHOLD_S) {
      current.end = r.end;
    } else {
      blocks.push(current);
      current = { shape: r.shape, start: r.start, end: r.end };
    }
  }
  blocks.push(current);

  // 3. Insere silenciamentos onde houver gap grande entre blocos consecutivos.
  // Também filtra blocos curtíssimos (< MIN_KEYFRAME_DURATION_S) que tendem a
  // ser ruído de transição.
  /** @type {Viseme[]} */
  const visemes = [];
  for (let i = 0; i < blocks.length; i++) {
    const b = blocks[i];
    const dur = b.end - b.start;

    // Co-articulação: bilabiais (M/B/P) — começa fechamento antes do tempo
    // nominal pra dar antecipação visual.
    let blockStart = b.start;
    if (b.shape === 'M' && i > 0) {
      const prev = blocks[i - 1];
      // Só antecipa se o anterior não era também bilabial e há espaço.
      if (prev.shape !== 'M' && b.start - prev.end >= 0) {
        blockStart = Math.max(prev.end, b.start - BILABIAL_LEAD_S);
      }
    }

    // Insere silent ANTES do bloco se gap > threshold.
    const prev = i > 0 ? blocks[i - 1] : null;
    if (prev && blockStart - prev.end >= SILENCE_GAP_THRESHOLD_S) {
      // Silent começa logo após o anterior fechar (sem cobrir o bloco atual)
      visemes.push({
        time: prev.end + 0.01,
        shape: 'silent',
        weight: 0.0,
      });
    }

    // Skip blocos muito curtos a menos que sejam silenciamentos
    if (dur < MIN_KEYFRAME_DURATION_S && b.shape !== 'silent') continue;

    // Peso (intensidade) — vogais e bilabiais têm peso maior, consoantes neutras
    // ficam mais discretas. Ajuda o orb/Rive a não exagerar em consoantes
    // intercaladas.
    const weight = weightForShape(b.shape);

    visemes.push({
      time: blockStart,
      shape: b.shape,
      weight,
    });
  }

  // 4. Garante silent final (boca fecha quando termina a fala)
  const lastBlock = blocks[blocks.length - 1];
  if (lastBlock && lastBlock.shape !== 'silent') {
    visemes.push({
      time: lastBlock.end + 0.05,
      shape: 'silent',
      weight: 0.0,
    });
  }

  return visemes;
}

/**
 * Classifica um único caractere em viseme via grafema.
 * Cobre inglês primário; português via diacríticos comuns.
 *
 * @param {string} ch
 * @returns {string}
 */
export function classifyCharacterToViseme(ch) {
  if (!ch) return 'silent';
  const c = ch.toLowerCase();
  // Pontuação, espaço, quebras → silent
  if (/^[\s.,!?;:'"\-—–()[\]{}]$/.test(c)) return 'silent';

  // Vogais — principal driver visual
  if (/[aäâã]/.test(c)) return 'AA';
  if (/[eéê]/.test(c)) return 'EH';
  if (/[iíy]/.test(c)) return 'IY';
  if (/[oóôõ]/.test(c)) return 'OH';
  if (/[uú]/.test(c)) return 'OW';

  // Labiodentais (F/V) — lábio inferior toca dente superior
  if (/[fv]/.test(c)) return 'F';

  // Bilabiais (M/B/P) — lábios fechados
  if (/[mbp]/.test(c)) return 'M';

  // L/N/T/D/S/Z/R/H — boca semi-aberta neutra
  if (/[lntdszrh]/.test(c)) return 'L';

  // C/G/K/Q/X/J/W/Y/CH — fallback neutro
  return 'L';
}

/** Peso visual por shape — vogais abertas mais pronunciadas. */
function weightForShape(shape) {
  switch (shape) {
    case 'AA':
      return 1.0;
    case 'EH':
      return 0.8;
    case 'IY':
      return 0.65;
    case 'OH':
      return 0.95;
    case 'OW':
      return 0.9;
    case 'M':
      return 0.85;
    case 'F':
      return 0.7;
    case 'L':
      return 0.45;
    case 'silent':
    default:
      return 0.0;
  }
}
