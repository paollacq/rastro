// PTAX: the Central Bank's reference dollar rate, from its open data API (Olinda).
// We use the buying rate ("compra") of the latest day available. On weekends and holidays
// there is no new PTAX, so the screen always shows the date next to the rate.

export interface Ptax {
  rate: string; // "5.4123", 4 decimals as published
  date: string; // "2026-10-09"
  source: 'bcb' | 'last-used' | 'override';
}

const OLINDA = 'https://olinda.bcb.gov.br/olinda/servico/PTAX/versao/v1/odata';
const CACHE_MS = 10 * 60_000;
let cached: { ptax: Ptax; at: number } | undefined;

export function brazilDate(at: Date) {
  // en-CA formats as YYYY-MM-DD
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Sao_Paulo' }).format(at);
}

const toOlindaDate = (iso: string) => `${iso.slice(5, 7)}-${iso.slice(8, 10)}-${iso.slice(0, 4)}`;

export function ptaxUrl(now: Date) {
  const end = brazilDate(now);
  const start = brazilDate(new Date(now.getTime() - 10 * 86_400_000)); // covers Carnaval
  return (
    `${OLINDA}/CotacaoDolarPeriodo(dataInicial=@dataInicial,dataFinalCotacao=@dataFinalCotacao)` +
    `?@dataInicial='${toOlindaDate(start)}'&@dataFinalCotacao='${toOlindaDate(end)}'` +
    `&$select=cotacaoCompra,dataHoraCotacao&$format=json`
  );
}

export function parsePtax(body: unknown): Ptax {
  const rows = (body as { value?: { cotacaoCompra: number; dataHoraCotacao: string }[] })?.value ?? [];
  const latest = [...rows].sort((a, b) => a.dataHoraCotacao.localeCompare(b.dataHoraCotacao)).at(-1);
  if (!latest || !(latest.cotacaoCompra > 0)) throw new Error('the PTAX answer had no rate in it');
  return { rate: latest.cotacaoCompra.toFixed(4), date: latest.dataHoraCotacao.slice(0, 10), source: 'bcb' };
}

export async function latestPtax(
  options: { now?: Date; fallback?: () => Promise<Omit<Ptax, 'source'> | null> } = {},
): Promise<Ptax> {
  // PTAX_OVERRIDE=5.4123@2026-10-09, for a recording that must not depend on the BCB.
  const override = process.env.PTAX_OVERRIDE;
  if (override) {
    const [rate, date] = override.split('@');
    return { rate, date, source: 'override' };
  }

  const now = options.now ?? new Date();
  if (cached && now.getTime() - cached.at < CACHE_MS) return cached.ptax;

  try {
    const res = await fetch(ptaxUrl(now), { signal: AbortSignal.timeout(5_000) });
    if (!res.ok) throw new Error(`BCB answered ${res.status}`);
    const ptax = parsePtax(await res.json());
    cached = { ptax, at: now.getTime() };
    return ptax;
  } catch (error) {
    const last = await options.fallback?.();
    if (last) return { ...last, source: 'last-used' };
    throw new Error(`no PTAX: ${error instanceof Error ? error.message : String(error)}`);
  }
}

export function clearPtaxCache() {
  cached = undefined;
}
