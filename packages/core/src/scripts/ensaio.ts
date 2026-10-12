// The whole demo, against a running app, as many times as asked, timed. This is the
// Etapa 5 finish line: five runs in a row with no error, on the public URL.
//
//   pnpm ensaio                                  5 runs against http://localhost:3000
//   pnpm ensaio --url https://rastro.vercel.app  against the deploy
//   pnpm ensaio --runs 1                         one run, for a quick look
//   pnpm ensaio --keep                           leaves the last run's data on screen
//
// Each run resets the demo first, so every one starts from the same frame: quote, pay,
// withdraw, Pix, burn, and the Pix ID checked against the burn memo. The worker has to be
// running (pnpm worker), because it is what moves the withdrawal along.
import { endToEndFormat } from '@rastro/pix';
import { parseArgs } from 'node:util';
import { createContext } from '../context.ts';
import { resetDemo } from '../demo.ts';
import { AppError, shortError } from '../errors.ts';

const { values: opts } = parseArgs({
  options: {
    url: { type: 'string', default: 'http://localhost:3000' },
    runs: { type: 'string', default: '5' },
    keep: { type: 'boolean', default: false },
  },
});

const base = opts.url.replace(/\/$/, '');
const runs = Number(opts.runs);
const ctx = createContext();

interface Run {
  n: number;
  ok: boolean;
  steps: Record<string, number>;
  total: number;
  note: string;
}

async function api<T>(path: string, body?: unknown): Promise<T> {
  const res = await fetch(`${base}${path}`, {
    method: body ? 'POST' : 'GET',
    headers: body ? { 'content-type': 'application/json' } : undefined,
    body: body ? JSON.stringify(body) : undefined,
    signal: AbortSignal.timeout(30_000),
  });
  const answer = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(`${path} respondeu ${res.status}: ${(answer as { error?: string }).error ?? ''}`);
  return answer as T;
}

// Asks the trail until `done` says so, or gives up and says what it was waiting for, where
// the withdrawal stopped and what the app itself thinks is wrong.
async function until<T extends Trace>(path: string, done: (body: T) => boolean, what: string, seconds = 90): Promise<T> {
  const deadline = Date.now() + seconds * 1000;
  let last: T | undefined;
  while (Date.now() < deadline) {
    last = await api<T>(path);
    if (done(last)) return last;
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
  const stuck = last?.withdrawals[0]?.status ?? last?.invoice?.status ?? 'nada';
  throw new Error(`${what} não aconteceu em ${seconds}s (parou em ${stuck}).${await diagnose()}`);
}

// The app answers for itself: which of the three is down, or whether the token is paused.
async function diagnose(): Promise<string> {
  try {
    const health = await api<{ ok: boolean; checks: Record<string, { ok: boolean; detail: string }> }>('/api/health');
    const bad = Object.entries(health.checks)
      .filter(([, check]) => !check.ok)
      .map(([name, check]) => `${name}: ${check.detail}`);
    if (bad.length) return `\n     ${bad.join('\n     ')}`;
    if (health.checks.tbrl?.detail.startsWith('pausado')) {
      return '\n     o tBRL está pausado: restaure o lastro em /admin ou com pnpm lastro';
    }
    return '\n     /api/health não vê problema, então olhe o worker (pnpm worker) e o log dele';
  } catch (error) {
    return `\n     /api/health também não respondeu: ${shortError(error)}`;
  }
}

type Trace = {
  invoice: { status: string } | null;
  quote: { brlOut: string } | null;
  withdrawals: { id: string; status: string; e2eId: string | null; burnMemoMatchesPix: boolean | null }[];
};

async function once(n: number): Promise<Run> {
  const steps: Record<string, number> = {};
  const started = Date.now();
  const lap = (name: string, from: number) => (steps[name] = Math.round((Date.now() - from) / 100) / 10);

  const t0 = Date.now();
  await resetDemo(ctx);
  lap('reset', t0);

  const t1 = Date.now();
  const quote = await api<{ id: string; quote: { brlOut: string } }>('/api/quote', { invoiceId: 'fatura-0047' });
  lap('cotação', t1);

  const t2 = Date.now();
  await api('/api/pay', { quoteId: quote.id });
  await until<Trace>('/api/trace/fatura-0047', (t) => t.invoice?.status === 'paga', 'o pagamento');
  lap('pagamento', t2);

  // Everything Ana just received, out by Pix.
  const cents = BigInt(quote.quote.brlOut) / 10_000n;
  const amountBrl = `${cents / 100n}.${(cents % 100n).toString().padStart(2, '0')}`;

  const t3 = Date.now();
  const withdrawal = await api<{ id: string }>('/api/withdraw', { amountBrl, invoiceId: 'fatura-0047' });
  const sent = await until<Trace>(
    `/api/trace/${withdrawal.id}`,
    (t) => Boolean(t.withdrawals[0]?.e2eId),
    'o Pix sair',
  );
  lap('pix', t3);

  const t4 = Date.now();
  const done = await until<Trace>(
    `/api/trace/${withdrawal.id}`,
    (t) => t.withdrawals[0]?.burnMemoMatchesPix === true,
    'a queima com o ID do Pix no memo',
  );
  lap('queima', t4);

  const e2eId = done.withdrawals[0]?.e2eId ?? '';
  const format = endToEndFormat(e2eId);
  if (!format) throw new Error(`o ID do Pix não tem formato conhecido: ${e2eId}`);

  return {
    n,
    ok: true,
    steps,
    total: Math.round((Date.now() - started) / 100) / 10,
    note: `R$ ${amountBrl} · ${e2eId} (${format}, ${e2eId.length} caracteres) · ${sent.withdrawals[0]?.status}`,
  };
}

console.log(`ensaio: ${runs} ${runs === 1 ? 'execução' : 'execuções'} contra ${base}\n`);
const results: Run[] = [];
let failed = false;

for (let n = 1; n <= runs && !failed; n++) {
  try {
    const run = await once(n);
    results.push(run);
    const times = Object.entries(run.steps)
      .map(([name, seconds]) => `${name} ${seconds}s`)
      .join('  ');
    console.log(`${n}/${runs}  ${run.total.toFixed(1).padStart(5)}s   ${times}`);
    console.log(`       ${run.note}`);
  } catch (error) {
    failed = true;
    console.log(`${n}/${runs}  falhou: ${error instanceof AppError ? error.message : shortError(error)}`);
  }
}

if (!failed && results.length) {
  const totals = results.map((run) => run.total).sort((a, b) => a - b);
  const median = totals[Math.floor(totals.length / 2)];
  console.log(`\nOK: ${results.length} ${results.length === 1 ? 'execução' : 'execuções'} sem erro.`);
  console.log(`mediana ${median.toFixed(1)}s, mais rápida ${totals[0].toFixed(1)}s, mais lenta ${totals.at(-1)?.toFixed(1)}s`);

} else {
  console.log('\nA contagem recomeça do zero depois do conserto.');
  process.exitCode = 1;
}

if (!opts.keep && !failed) await resetDemo(ctx);
await ctx.db.sql.end();
