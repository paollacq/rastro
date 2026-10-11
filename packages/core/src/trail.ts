import type { Trace, TraceWithdrawal } from './trace.ts';

// The six steps of the trail page, worked out from a trace. No I/O and type-only imports,
// so the page can run it in the browser on every poll; the words live in the screen.
//
//   emitida → paga → convertida → carteira → pix → queima   (or → devolvida, if the Pix fails)
//
// A trail that starts from a withdrawal with no invoice behind it begins at "carteira".

export type StepKey = 'emitida' | 'paga' | 'convertida' | 'carteira' | 'pix' | 'queima' | 'devolvida';
export type StepState = 'feito' | 'agora' | 'falhou' | 'esperando';

export interface TrailStep {
  key: StepKey;
  state: StepState;
  at: string | null;
  tx: string | null;
}

// The Pix ID next to the memo the burn carried on-chain, character by character.
export interface Comparison {
  pixId: string;
  memo: string;
  memoHex: string | null;
  equal: number;
  length: number;
  matches: boolean;
  format: 'official' | 'sandbox' | null;
  provider: string | null;
  at: string | null;
  burnTx: string;
}

export interface Trail {
  steps: TrailStep[];
  withdrawal: TraceWithdrawal | null;
  others: TraceWithdrawal[];
  comparison: Comparison | null;
  // Nothing left to wait for: the page stops asking.
  settled: boolean;
}

// Dates are Date objects on the server and ISO strings once they went through JSON.
type When = Date | string | null | undefined;
const iso = (value: When) => (value ? new Date(value).toISOString() : null);

export function trailOf(trace: Trace): Trail {
  const followed = follow(trace.withdrawals);
  const others = trace.withdrawals.filter((w) => w !== followed);
  const steps: TrailStep[] = [];

  if (trace.invoice) {
    const fill = trace.quote?.fillTx ?? null;
    const paid = trace.invoice.status === 'paga' || Boolean(fill);
    const filled = trace.payment.find((event) => event.event === 'Filled') ?? trace.payment[0];
    const paidAt = paid ? (iso(filled?.blockTime) ?? iso(trace.invoice.paidAt)) : null;
    const state: StepState = paid ? 'feito' : 'esperando';
    steps.push({ key: 'emitida', state: 'feito', at: iso(trace.invoice.issuedAt), tx: null });
    // The dollars in, the conversion and the tBRL out are one fill: one transaction, one time.
    steps.push({ key: 'paga', state, at: paidAt, tx: fill });
    steps.push({ key: 'convertida', state, at: paidAt, tx: null });
    steps.push({ key: 'carteira', state, at: paidAt, tx: null });
  } else {
    steps.push({ key: 'carteira', state: 'feito', at: null, tx: null });
  }

  const w = followed;
  if (!w) {
    steps.push({ key: 'pix', state: 'esperando', at: null, tx: null });
    steps.push({ key: 'queima', state: 'esperando', at: null, tx: null });
    return { steps, withdrawal: null, others, comparison: null, settled: false };
  }

  const when = (...statuses: TraceWithdrawal['status'][]) =>
    iso(w.steps.findLast((step) => statuses.includes(step.status))?.at);
  const transferTx = w.transfer[0]?.txHash ?? null;
  const burn = w.burn[0];
  const refund = w.refund[0];

  switch (w.status) {
    case 'SOLICITADO':
    case 'TBRL_NA_TESOURARIA':
    case 'PIX_ENVIADO':
      steps.push({ key: 'pix', state: 'agora', at: when(w.status), tx: transferTx });
      steps.push({ key: 'queima', state: 'esperando', at: null, tx: null });
      break;
    case 'PIX_CONFIRMADO':
      steps.push({ key: 'pix', state: 'feito', at: when('PIX_CONFIRMADO'), tx: transferTx });
      steps.push({ key: 'queima', state: 'agora', at: null, tx: null });
      break;
    case 'QUEIMADO':
    case 'CONCLUIDO':
      steps.push({ key: 'pix', state: 'feito', at: when('PIX_CONFIRMADO'), tx: transferTx });
      steps.push({
        key: 'queima',
        state: 'feito',
        at: iso(burn?.blockTime) ?? when('QUEIMADO'),
        tx: burn?.txHash ?? null,
      });
      break;
    case 'FALHOU':
      steps.push({ key: 'pix', state: 'falhou', at: when('FALHOU'), tx: transferTx });
      steps.push({ key: 'devolvida', state: 'agora', at: null, tx: null });
      break;
    case 'DEVOLVIDO':
      steps.push({ key: 'pix', state: 'falhou', at: when('FALHOU'), tx: transferTx });
      steps.push({
        key: 'devolvida',
        state: 'feito',
        at: iso(refund?.blockTime) ?? when('DEVOLVIDO'),
        tx: refund?.txHash ?? null,
      });
      break;
    case 'CANCELADO':
      // The tBRL never left Ana's wallet, so there is nothing to burn or give back.
      steps.push({ key: 'pix', state: 'falhou', at: when('CANCELADO'), tx: null });
      break;
  }

  const comparison = compare(w);
  // The status can say CONCLUIDO a pass before the watcher has copied the burn: keep asking
  // until the event itself is in.
  const settled =
    (w.status === 'CONCLUIDO' && Boolean(burn)) ||
    (w.status === 'DEVOLVIDO' && Boolean(refund)) ||
    w.status === 'CANCELADO';

  return { steps, withdrawal: w, others, comparison, settled };
}

// The withdrawal the trail follows: the latest one that moved money, else the latest.
function follow(withdrawals: TraceWithdrawal[]): TraceWithdrawal | null {
  return withdrawals.findLast((w) => w.status !== 'CANCELADO') ?? withdrawals.at(-1) ?? null;
}

function compare(w: TraceWithdrawal): Comparison | null {
  const burn = w.burn[0];
  if (!w.e2eId || !burn) return null;
  const pixId = w.e2eId;
  const memo = burn.memoText ?? '';
  let equal = 0;
  for (let i = 0; i < pixId.length; i++) if (memo[i] === pixId[i]) equal++;
  return {
    pixId,
    memo,
    memoHex: burn.memo,
    equal,
    length: pixId.length,
    matches: equal === pixId.length && memo.length === pixId.length,
    format: w.e2eFormat,
    provider: w.provider,
    at: iso(burn.blockTime),
    burnTx: burn.txHash,
  };
}
