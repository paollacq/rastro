import { explorer, tip403Registry } from '@rastro/chain';
import type { InvoiceItem, Withdrawal } from '@rastro/db';
import { toCents } from '@rastro/pix';
import { isAddressEqual, type Address, type Hex } from 'viem';
import { Abis } from 'viem/tempo';
import type { Context } from './context.ts';
import { shortError } from './errors.ts';
import { BASE_PER_CENT, baseToBrl, floorToCents } from './money.ts';
import { activePix, effectivePixMode } from './pix-mode.ts';
import { QUOTE_SECONDS } from './quote.ts';
import { trace, type Trace } from './trace.ts';

// What each screen reads, shaped for it: amounts as plain decimal strings ("8293.26"),
// dates as ISO strings. Pages call these on the server. Nothing here signs or moves money.

export { explorer };

// A chain or provider read that may fail without taking the page down. The screen shows
// what it has and says what it couldn't get.
export type Read<T> = { ok: true; value: T } | { ok: false; error: string };

async function attempt<T>(work: () => Promise<T>): Promise<Read<T>> {
  try {
    return { ok: true, value: await work() };
  } catch (error) {
    return { ok: false, error: shortError(error) };
  }
}

const iso = (value: Date | null | undefined) => (value ? value.toISOString() : null);
const reais = (base: string | bigint) => baseToBrl(floorToCents(BigInt(base)));
const dollars = (base: string) => reais(base); // pathUSD has 6 decimals too

// --- /invoice/[number] ------------------------------------------------------------------

export interface InvoiceView {
  invoice: {
    id: string;
    number: string;
    payerName: string;
    items: InvoiceItem[];
    description: string;
    amountUsd: string;
    status: 'aberta' | 'paga';
    issuedAt: string;
  };
  recipient: { name: string; city: string | null };
  payment: { brlOut: string; ptaxRate: string; ptaxDate: string; spreadBps: number; fillTx: string; paidAt: string } | null;
  quoteSeconds: number;
  pixMode: 'sandbox' | 'simulator';
}

export async function invoiceView(ctx: Context, number: string): Promise<InvoiceView | null> {
  const invoice = await ctx.db.invoiceByNumber(number);
  if (!invoice) return null;
  const recipient = await ctx.db.user(invoice.recipientId);
  const paid = (await ctx.db.paymentsTo(invoice.recipientId)).find((p) => p.invoiceId === invoice.id);

  return {
    invoice: {
      id: invoice.id,
      number: invoice.number,
      payerName: invoice.payerName,
      items: invoice.items,
      description: invoice.description,
      amountUsd: invoice.amountUsd,
      status: invoice.status,
      issuedAt: invoice.createdAt.toISOString(),
    },
    recipient: { name: recipient?.name ?? '', city: recipient?.city ?? null },
    payment: paid
      ? {
          brlOut: reais(paid.brlOut),
          ptaxRate: paid.ptaxRate,
          ptaxDate: paid.ptaxDate,
          spreadBps: paid.spreadBps,
          fillTx: paid.fillTx,
          paidAt: paid.paidAt.toISOString(),
        }
      : null,
    quoteSeconds: QUOTE_SECONDS,
    pixMode: await effectivePixMode(ctx),
  };
}

// --- /ana --------------------------------------------------------------------------------

export interface WithdrawalSummary {
  id: string;
  invoiceId: string | null;
  status: Withdrawal['status'];
  amountBrl: string;
  e2eId: string | null;
  provider: string | null;
  failure: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface ReceivedPayment {
  invoiceId: string;
  number: string;
  payerName: string;
  amountUsd: string;
  brlOut: string;
  ptaxRate: string;
  ptaxDate: string;
  spreadBps: number;
  fillTx: string;
  paidAt: string;
  withdrawal: WithdrawalSummary | null;
  // What the button would take out now: the payment, or less if the wallet holds less.
  // null when it already went out (or is going).
  withdrawable: string | null;
}

export interface WalletView {
  user: {
    id: string;
    name: string;
    city: string | null;
    wallet: string;
    pixKeyMasked: string | null;
    autoWithdraw: boolean;
  };
  balance: Read<string>;
  policy: { id: string; identified: Read<boolean> } | null;
  payments: ReceivedPayment[];
  withdrawals: WithdrawalSummary[];
  pixMode: 'sandbox' | 'simulator';
}

export async function walletView(ctx: Context, userId: string): Promise<WalletView | null> {
  const user = await ctx.db.user(userId);
  if (!user) return null;
  const wallet = user.wallet as Address;

  const [balance, identified, payments, withdrawals] = await Promise.all([
    attempt(() =>
      ctx.client.readContract({ address: ctx.addresses.tbrl, abi: Abis.tip20, functionName: 'balanceOf', args: [wallet] }),
    ),
    ctx.addresses.policyId === undefined ? null : isIdentified(ctx, wallet),
    ctx.db.paymentsTo(userId),
    ctx.db.withdrawalsOf(userId),
  ]);

  const summaries = withdrawals.map(summarize);
  const spendable = balance.ok ? floorToCents(balance.value) : 0n;

  return {
    user: {
      id: user.id,
      name: user.name,
      city: user.city,
      wallet: user.wallet,
      pixKeyMasked: user.pixKeyMasked,
      autoWithdraw: user.autoWithdrawSince !== null,
    },
    balance: balance.ok ? { ok: true, value: baseToBrl(spendable) } : balance,
    policy:
      ctx.addresses.policyId === undefined || identified === null
        ? null
        : { id: ctx.addresses.policyId.toString(), identified },
    payments: payments.map((p) => {
      const withdrawal = summaries.find((w) => w.invoiceId === p.invoiceId && w.status !== 'CANCELADO') ?? null;
      const open = !withdrawal || withdrawal.status === 'DEVOLVIDO';
      const due = BigInt(p.brlOut) < spendable ? BigInt(p.brlOut) : spendable;
      return {
        invoiceId: p.invoiceId,
        number: p.number,
        payerName: p.payerName,
        amountUsd: p.amountUsd,
        brlOut: reais(p.brlOut),
        ptaxRate: p.ptaxRate,
        ptaxDate: p.ptaxDate,
        spreadBps: p.spreadBps,
        fillTx: p.fillTx,
        paidAt: p.paidAt.toISOString(),
        withdrawal,
        withdrawable: open && due > 0n ? baseToBrl(floorToCents(due)) : null,
      };
    }),
    withdrawals: summaries,
    pixMode: await effectivePixMode(ctx),
  };
}

function summarize(w: Withdrawal): WithdrawalSummary {
  return {
    id: w.id,
    invoiceId: w.invoiceId,
    status: w.status,
    amountBrl: reais(w.amountBrl),
    e2eId: w.e2eId,
    provider: w.provider,
    failure: w.failure,
    createdAt: w.createdAt.toISOString(),
    updatedAt: w.updatedAt.toISOString(),
  };
}

// Straight from the TIP-403 registry, not from our database.
function isIdentified(ctx: Context, wallet: Address): Promise<Read<boolean>> {
  const policyId = ctx.addresses.policyId as bigint;
  return attempt(() =>
    ctx.client.readContract({
      address: tip403Registry,
      abi: Abis.tip403Registry,
      functionName: 'isAuthorized',
      args: [policyId, wallet],
    }),
  );
}

// --- /console ----------------------------------------------------------------------------

export interface OperationRow {
  kind: 'conversao' | 'saque';
  at: string;
  client: { name: string; cpfMasked: string | null; wallet: string; pixKeyMasked: string | null };
  invoice: { id: string; number: string; payerName: string | null; payerWallet: string | null } | null;
  usd: string | null;
  ptax: { rate: string; date: string; spreadBps: number } | null;
  // Reais per dollar actually paid out: PTAX less the spread, rounded down to the centavo.
  rate: string | null;
  brl: string | null;
  withdrawal: { id: string; status: Withdrawal['status']; amountBrl: string; e2eId: string | null; provider: string | null } | null;
  fillTx: string | null;
  transferTx: string | null;
  burnTx: string | null;
}

// The console shows the latest 500; the CSV asks for everything in its range.
export async function operationsView(ctx: Context, range: { from?: Date; to?: Date } = {}, limit = 500): Promise<OperationRow[]> {
  const rows = await ctx.db.operations(range, limit);
  return rows.map((op) => ({
    kind: op.kind,
    at: op.at.toISOString(),
    client: { name: op.clientName, cpfMasked: op.cpfMasked, wallet: op.clientWallet, pixKeyMasked: op.pixKeyMasked },
    invoice: op.invoiceId
      ? { id: op.invoiceId, number: op.invoiceNumber ?? '', payerName: op.payerName, payerWallet: op.payerWallet }
      : null,
    usd: op.usdIn ? dollars(op.usdIn) : null,
    ptax: op.ptaxRate && op.ptaxDate ? { rate: op.ptaxRate, date: op.ptaxDate, spreadBps: op.spreadBps ?? 0 } : null,
    rate: op.usdIn && op.brlOut ? effectiveRate(op.brlOut, op.usdIn) : null,
    brl: op.brlOut ? reais(op.brlOut) : null,
    withdrawal: op.withdrawalId
      ? {
          id: op.withdrawalId,
          status: op.withdrawalStatus ?? 'SOLICITADO',
          amountBrl: reais(op.withdrawnBrl ?? '0'),
          e2eId: op.e2eId,
          provider: op.provider,
        }
      : null,
    fillTx: op.fillTx,
    transferTx: op.transferTx,
    burnTx: op.burnTx,
  }));
}

// "8293260000" / "1540000000" -> "5.3852"
export function effectiveRate(brlOutBase: string, usdInBase: string) {
  const scaled = (BigInt(brlOutBase) * 10_000n) / BigInt(usdInBase);
  return `${scaled / 10_000n}.${(scaled % 10_000n).toString().padStart(4, '0')}`;
}

export interface AllowlistEntry {
  wallet: string;
  holder: { kind: 'tesouraria' | 'rfq' | 'cliente' | 'outro'; name: string | null };
  identified: Read<boolean>;
  since: string | null;
  tx: string | null;
  // Who asked for it, when it was us: "cadastro cliente-x7k2m9" or the setup script.
  by: string | null;
}

export interface AllowlistView {
  policyId: string | null;
  registry: string;
  entries: AllowlistEntry[];
}

// Whoever the whitelist events name, plus the wallets we know, each checked live against the
// registry: the events say when, the registry says whether.
export async function allowlistView(ctx: Context): Promise<AllowlistView> {
  const { policyId } = ctx.addresses;
  if (policyId === undefined) return { policyId: null, registry: tip403Registry, entries: [] };

  const [events, users, changes] = await Promise.all([
    ctx.db.policyEvents(tip403Registry, policyId.toString()),
    ctx.db.users(),
    ctx.db.policyChanges(),
  ]);
  const wallets = new Map<string, { since: string | null; tx: string | null }>();
  for (const event of events) {
    if (!event.toAddress) continue;
    wallets.set(event.toAddress.toLowerCase(), { since: iso(event.blockTime), tx: event.txHash });
  }
  for (const known of [ctx.addresses.treasury, ctx.addresses.rfq, ...users.filter((u) => u.role === 'recebedora').map((u) => u.wallet)]) {
    if (!wallets.has(known.toLowerCase())) wallets.set(known.toLowerCase(), { since: null, tx: null });
  }

  const entries = await Promise.all(
    [...wallets].map(async ([wallet, { since, tx }]): Promise<AllowlistEntry> => {
      const user = users.find((u) => u.wallet.toLowerCase() === wallet);
      const holder: AllowlistEntry['holder'] = isAddressEqual(wallet as Hex, ctx.addresses.treasury)
        ? { kind: 'tesouraria', name: null }
        : isAddressEqual(wallet as Hex, ctx.addresses.rfq)
          ? { kind: 'rfq', name: null }
          : user
            ? { kind: 'cliente', name: user.name }
            : { kind: 'outro', name: null };
      const asked = changes.find((change) => change.wallet.toLowerCase() === wallet && change.allowed);
      return { wallet, holder, identified: await isIdentified(ctx, wallet as Address), since, tx, by: asked?.actor ?? null };
    }),
  );
  // On the list first, then by when they joined.
  entries.sort(
    (a, b) =>
      Number(b.identified.ok && b.identified.value) - Number(a.identified.ok && a.identified.value) ||
      (a.since ?? '').localeCompare(b.since ?? ''),
  );
  return { policyId: policyId.toString(), registry: tip403Registry, entries };
}

export interface BlockedView {
  policyId: string | null;
  attempts: { at: string; from: string | null; to: string | null; amountBrl: string | null; reason: string }[];
}

export async function blockedView(ctx: Context): Promise<BlockedView> {
  const attempts = await ctx.db.blockedAttempts();
  return {
    policyId: ctx.addresses.policyId?.toString() ?? null,
    attempts: attempts.map((a) => ({
      at: a.at.toISOString(),
      from: a.fromAddress,
      to: a.toAddress,
      amountBrl: a.amount ? reais(a.amount) : null,
      reason: a.reason,
    })),
  };
}

export interface ReservesView {
  supply: Read<string>;
  balance: Read<string>;
  provider: 'payzu-sandbox' | 'simulator';
  // Already paid out by Pix, with the tBRL still waiting to be burned.
  inFlight: string;
  // Reais of tBRL with no reais behind them; "0.00" when the reserve covers the supply.
  shortfall: string | null;
  paused: Read<boolean>;
  // When the chain recorded the last pause or unpause, and which transaction did it.
  pausedAt: string | null;
  pauseTx: string | null;
  checks: { at: string; supply: string; balanceBrl: string; ok: boolean }[];
}

// The invariant: tBRL in circulation never exceeds the reais in the Pix account.
export async function reservesView(ctx: Context): Promise<ReservesView> {
  const pix = await activePix(ctx);
  const [supply, balance, paused, checks, lastPause, inFlight] = await Promise.all([
    attempt(() => ctx.client.readContract({ address: ctx.addresses.tbrl, abi: Abis.tip20, functionName: 'totalSupply' })),
    attempt(() => pix.balance()),
    attempt(() => ctx.client.readContract({ address: ctx.addresses.tbrl, abi: Abis.tip20, functionName: 'paused' })),
    ctx.db.reserveChecks(),
    ctx.db.lastPauseChange(),
    ctx.db.inFlightBrl(),
  ]);

  let shortfall: string | null = null;
  if (supply.ok && balance.ok) {
    // Plus whatever Pix has already paid out and the burn has not caught up with yet.
    const backed = toCents(balance.value.availableBrl) * BASE_PER_CENT + inFlight;
    // Rounded up: a fraction of a centavo without backing still breaks the invariant.
    const missing = supply.value > backed ? supply.value - backed : 0n;
    shortfall = baseToBrl(missing + ((BASE_PER_CENT - (missing % BASE_PER_CENT)) % BASE_PER_CENT));
  }

  return {
    supply: supply.ok ? { ok: true, value: exactReais(supply.value) } : supply,
    balance: balance.ok ? { ok: true, value: balance.value.availableBrl } : balance,
    provider: pix.name,
    inFlight: baseToBrl(floorToCents(inFlight)),
    shortfall,
    paused,
    pausedAt: lastPause?.paused ? iso(lastPause.at) : null,
    pauseTx: lastPause?.paused ? lastPause.txHash : null,
    checks: checks.map((c) => ({
      at: c.at.toISOString(),
      supply: exactReais(BigInt(c.supply)),
      balanceBrl: c.balanceBrl,
      ok: c.ok,
    })),
  };
}

// Supply can hold fractions of a centavo (6 decimals); show them rather than hide them.
function exactReais(base: bigint) {
  const whole = base / 1_000_000n;
  const fraction = (base % 1_000_000n).toString().padStart(6, '0').replace(/0{1,4}$/, '');
  return `${whole}.${fraction.padEnd(2, '0')}`;
}

// --- / -------------------------------------------------------------------------------------

// The landing shows a real trail: the latest finished withdrawal, ideally one that came from
// an invoice, or else the demo invoice wherever it stands.
export async function showcaseTrace(ctx: Context): Promise<Trace | null> {
  const id = await ctx.db.showcaseWithdrawal();
  return (id ? await trace(ctx, id) : null) ?? (await trace(ctx, 'fatura-0047'));
}
