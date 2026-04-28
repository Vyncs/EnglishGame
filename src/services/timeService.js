/**
 * Helpers de fuso horário.
 *
 * Decisão de produto: streak é por DIA LOCAL do usuário, não 24h corridas.
 * V1 default = America/Sao_Paulo. Arquitetura suporta per-user (UserPreferences.timezone).
 *
 * Não usamos biblioteca externa — Intl.DateTimeFormat resolve com 0 deps.
 */

export const DEFAULT_TIMEZONE = 'America/Sao_Paulo';

/**
 * Resolve o timezone do user. Aceita o objeto user (com preferences inline)
 * ou apenas o objeto preferences. Cai no default se ausente/inválido.
 */
export function getUserTimezone(userOrPrefs) {
  if (!userOrPrefs) return DEFAULT_TIMEZONE;
  const tz = userOrPrefs.preferences?.timezone || userOrPrefs.timezone;
  if (!tz) return DEFAULT_TIMEZONE;
  // Validação leve — Intl rejeita timezones inválidos.
  try {
    new Intl.DateTimeFormat('en-CA', { timeZone: tz });
    return tz;
  } catch {
    return DEFAULT_TIMEZONE;
  }
}

/**
 * Retorna a data local (YYYY-MM-DD) no fuso especificado.
 * Usa locale 'en-CA' que naturalmente formata como YYYY-MM-DD.
 */
export function localDate(timezone = DEFAULT_TIMEZONE, date = new Date()) {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: timezone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(date);
}

/** YYYY-MM-DD do "hoje" no fuso indicado. */
export function todayLocal(timezone = DEFAULT_TIMEZONE) {
  return localDate(timezone);
}

/** YYYY-MM-DD do "ontem" no fuso indicado. */
export function yesterdayLocal(timezone = DEFAULT_TIMEZONE) {
  return localDate(timezone, new Date(Date.now() - 86_400_000));
}

/**
 * Diferença em dias entre duas strings YYYY-MM-DD.
 * Positivo se b > a. Funciona independente de fuso porque usa UTC pra parsear.
 */
export function daysBetween(dateA, dateB) {
  if (!dateA || !dateB) return null;
  const a = Date.UTC(...dateA.split('-').map(Number).map((v, i) => (i === 1 ? v - 1 : v)));
  const b = Date.UTC(...dateB.split('-').map(Number).map((v, i) => (i === 1 ? v - 1 : v)));
  return Math.round((b - a) / 86_400_000);
}

/**
 * Lista de N datas anteriores (incluindo hoje), em ordem cronológica.
 * Útil pra calendário de semana / mês.
 */
export function lastNDates(n, timezone = DEFAULT_TIMEZONE) {
  const dates = [];
  const now = Date.now();
  for (let i = n - 1; i >= 0; i--) {
    dates.push(localDate(timezone, new Date(now - i * 86_400_000)));
  }
  return dates;
}

/**
 * Hora local atual (0-23) no fuso indicado. Usado pra detectar "tarde demais
 * pra streak" (>= 18h sem atividade hoje = at_risk).
 */
export function localHour(timezone = DEFAULT_TIMEZONE, date = new Date()) {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: timezone,
    hour: '2-digit',
    hour12: false,
  }).formatToParts(date);
  const h = parts.find((p) => p.type === 'hour');
  return h ? Number(h.value) % 24 : 0;
}
