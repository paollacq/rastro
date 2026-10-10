import { explorer } from '@rastro/chain';
import type { ChainEvent, PixEvent, Withdrawal, WithdrawalStep } from '@rastro/db';
import { endToEndFormat } from '@rastro/pix';
import type { Context } from './context.ts';
import { baseToBrl } from './money.ts';

// GET /api/trace/:id — the whole path of a payment, for the trail page.
// fatura-XXXX: invoice, quote, the fill, and any withdrawals made from it.
// saque-XXXXXXXX: one withdrawal, with the invoice it came from when there is one.

export interface TraceWithdrawal {
  id: string;
  status: Withdrawal['status'];
  amountBrl: string;
  provider: string | null;
  e2eId: string | null;
  e2eFormat: 'official' | 'sandbox' | null;
  failure: string | null;
  steps: Pick<WithdrawalStep, 'status' | 'detail' | 'at'>[];
  transfer: ChainEvent[];
  burn: ChainEvent[];
  refund: ChainEvent[];
  pix: Pick<PixEvent, 'provider' | 'event' | 'status' | 'e2eId' | 'signatureOk' | 'receivedAt'>[];
  burnMemoMatchesPix: boolean | null;
}

export interface Trace {
  explorer: string;
  invoice: { id: string; number: string; payerName: string; description: string; amountUsd: string; status: string } | null;
  quote: { id: string; ptaxRate: string; ptaxDate: string; spreadBps: number; usdIn: string; brlOut: string; expiresAt: string; fillTx: string | null } | null;
  payment: ChainEvent[];
  withdrawals: TraceWithdrawal[];
}

export async function trace(ctx: Context, id: string): Promise<Trace | null> {
  let invoiceId: string | null = null;
  let withdrawals: Withdrawal[] = [];

  if (id.startsWith('saque-')) {
    const withdrawal = await ctx.db.withdrawal(id);
    if (!withdrawal) return null;
    withdrawals = [withdrawal];
    invoiceId = withdrawal.invoiceId;
  } else {
    if (!(await ctx.db.invoice(id))) return null;
    invoiceId = id;
    withdrawals = await ctx.db.withdrawalsForInvoice(id);
  }

  const invoice = invoiceId ? await ctx.db.invoice(invoiceId) : null;
  const quotes = invoiceId ? await ctx.db.quotesForInvoice(invoiceId) : [];
  const quote = quotes.find((q) => q.fillTx) ?? quotes.at(-1) ?? null;
  const payment = quote?.fillTx ? await ctx.db.chainEventsForTxs([quote.fillTx]) : [];

  return {
    explorer,
    invoice: invoice && {
      id: invoice.id,
      number: invoice.number,
      payerName: invoice.payerName,
      description: invoice.description,
      amountUsd: invoice.amountUsd,
      status: invoice.status,
    },
    quote: quote && {
      id: quote.id,
      ptaxRate: quote.ptaxRate,
      ptaxDate: quote.ptaxDate,
      spreadBps: quote.spreadBps,
      usdIn: baseToUnits(quote.usdIn),
      brlOut: baseToBrl(BigInt(quote.brlOut)),
      expiresAt: quote.expiry.toISOString(),
      fillTx: quote.fillTx,
    },
    payment: payment.filter((event) => event.event === 'TransferWithMemo' || event.event === 'Filled'),
    withdrawals: await Promise.all(withdrawals.map((w) => traceWithdrawal(ctx, w))),
  };
}

async function traceWithdrawal(ctx: Context, w: Withdrawal): Promise<TraceWithdrawal> {
  const txs = [w.transferTx, w.burnTx, w.refundTx].filter((hash): hash is string => Boolean(hash));
  const [steps, events, pix] = await Promise.all([ctx.db.steps(w.id), ctx.db.chainEventsForTxs(txs), ctx.db.pixEvents({ reference: w.id })]);
  const memoEvents = (hash: string | null) =>
    hash ? events.filter((event) => event.txHash === hash.toLowerCase() && event.event === 'TransferWithMemo') : [];
  const burn = memoEvents(w.burnTx);

  return {
    id: w.id,
    status: w.status,
    amountBrl: baseToBrl(BigInt(w.amountBrl)),
    provider: w.provider,
    e2eId: w.e2eId,
    e2eFormat: w.e2eId ? endToEndFormat(w.e2eId) : null,
    failure: w.failure,
    steps: steps.map(({ status, detail, at }) => ({ status, detail, at })),
    transfer: memoEvents(w.transferTx),
    burn,
    refund: memoEvents(w.refundTx),
    pix: pix.map(({ provider, event, status, e2eId, signatureOk, receivedAt }) => ({ provider, event, status, e2eId, signatureOk, receivedAt })),
    burnMemoMatchesPix: w.e2eId && burn.length > 0 ? burn.some((event) => event.memoText === w.e2eId) : null,
  };
}

// pathUSD base units to dollars with cents: "1540000000" -> "1540.00"
function baseToUnits(base: string) {
  const value = BigInt(base);
  return `${value / 1_000_000n}.${((value % 1_000_000n) / 10_000n).toString().padStart(2, '0')}`;
}
