// Numbers and dates the way each screen's language writes them: "R$ 8.293,26" in
// Portuguese, "R$ 8,293.26" in English. Amounts arrive as decimal strings and stay strings,
// so a centavo is never lost to a float. Times are always Brasília's.

export type Lang = 'pt' | 'en';

const ZONE = 'America/Sao_Paulo';
const NBSP = ' ';

export function amount(value: string, lang: Lang, minDecimals = 2): string {
  const negative = value.startsWith('-');
  const [whole, fraction = ''] = value.replace(/^-/, '').split('.');
  const grouped = whole.replace(/\B(?=(\d{3})+(?!\d))/g, lang === 'pt' ? '.' : ',');
  const decimals = fraction.padEnd(minDecimals, '0');
  return `${negative ? '−' : ''}${grouped}${decimals ? (lang === 'pt' ? ',' : '.') + decimals : ''}`;
}

export function money(value: string, currency: 'BRL' | 'USD', lang: Lang): string {
  return `${currency === 'BRL' ? 'R$' : 'US$'}${NBSP}${amount(value, lang)}`;
}

// 5.4123 -> "5,4123"
export const rate = (value: string, lang: Lang) => amount(value, lang, 4);

// 50 -> "0,50%"
export const percentFromBps = (bps: number, lang: Lang) =>
  `${amount((bps / 100).toFixed(2), lang)}%`;

function parts(iso: string, options: Intl.DateTimeFormatOptions, lang: Lang) {
  return new Intl.DateTimeFormat(lang === 'pt' ? 'pt-BR' : 'en-US', { timeZone: ZONE, ...options }).format(new Date(iso));
}

// "10/10/2026 18:25" · "Oct 10, 2026, 6:25 PM"
export const dateTime = (iso: string, lang: Lang) =>
  lang === 'pt'
    ? parts(iso, { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' }, lang).replace(',', '')
    : parts(iso, { month: 'short', day: 'numeric', year: 'numeric', hour: 'numeric', minute: '2-digit' }, lang);

// "10/10 18:25" · "Oct 10, 6:25 PM"
export const shortDateTime = (iso: string, lang: Lang) =>
  lang === 'pt'
    ? parts(iso, { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' }, lang).replace(',', '')
    : parts(iso, { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' }, lang);

// "10/10 18:25:39" · "Oct 10, 6:25:39 PM": steps seconds apart need the seconds
export const stamp = (iso: string, lang: Lang) =>
  lang === 'pt'
    ? parts(iso, { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit' }, lang).replace(',', '')
    : parts(iso, { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit', second: '2-digit' }, lang);

// "18:25:39" · "6:25:39 PM"
export const clock = (iso: string, lang: Lang) =>
  parts(iso, { hour: lang === 'pt' ? '2-digit' : 'numeric', minute: '2-digit', second: '2-digit' }, lang);

// "10/10/2026" · "Oct 10, 2026"
export const date = (iso: string, lang: Lang) =>
  lang === 'pt'
    ? parts(iso, { day: '2-digit', month: '2-digit', year: 'numeric' }, lang)
    : parts(iso, { month: 'short', day: 'numeric', year: 'numeric' }, lang);

// A PTAX day, "2026-10-09": "sexta, 09/10" · "Fri, Oct 9". Noon keeps it on the same date
// in any time zone.
export function ptaxDay(day: string, lang: Lang) {
  const iso = `${day}T12:00:00-03:00`;
  if (lang === 'en') return parts(iso, { weekday: 'short', month: 'short', day: 'numeric' }, lang);
  const weekday = parts(iso, { weekday: 'long' }, lang).replace('-feira', '');
  return `${weekday}, ${parts(iso, { day: '2-digit', month: '2-digit' }, lang)}`;
}

// "4:51 PM" · "16:51"
export const timeOnly = (iso: string, lang: Lang = 'en') =>
  parts(iso, { hour: lang === 'pt' ? '2-digit' : 'numeric', minute: '2-digit' }, lang);

// 0x12ab…9f3c
export const short = (hex: string, keep = 4) =>
  hex.length <= 2 + keep * 2 + 1 ? hex : `${hex.slice(0, 2 + keep)}…${hex.slice(-keep)}`;
