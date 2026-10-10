import { rastroRfqAbi } from '@rastro/chain';
import { loadDeployment } from '@rastro/chain/deployments';
import type { NewChainEvent } from '@rastro/db';
import { getAbiItem, hexToString, parseEventLogs, type Address, type Hash, type Hex, type Log } from 'viem';
import { Abis } from 'viem/tempo';
import type { Context } from './context.ts';

// Copies what happens on-chain into chain_events: every tBRL and RFQ event, plus pathUSD
// memo transfers into the treasury (the dollar leg of each payment). The cursor lives in
// worker_state, so a restart picks up where it stopped.

const CURSOR = 'chain_cursor';
const WINDOW = 2_000n; // blocks per getLogs call; about 17 minutes at 0.5 s blocks
const BACKFILL = 50_000n; // when there is no better start, about 7 hours back

const abi = [...Abis.tip20.filter((item) => item.type === 'event'), ...rastroRfqAbi.filter((item) => item.type === 'event')];
const memoTransfer = getAbiItem({ abi: Abis.tip20, name: 'TransferWithMemo' });

export async function syncChain(ctx: Context): Promise<number> {
  // viem caches the block number for a moment; the watcher wants the real head, minus a
  // couple of blocks so an RPC node a step behind can't make it skip any.
  const head = await ctx.client.getBlockNumber({ cacheTime: 0 });
  const lag = BigInt(process.env.WATCH_LAG_BLOCKS ?? '2');
  const latest = head > lag ? head - lag : 0n;
  const saved = await ctx.db.state(CURSOR);
  let from = saved ? BigInt(saved) + 1n : await startBlock(ctx, latest);
  const usd = await paymentToken(ctx);
  let inserted = 0;

  while (from <= latest) {
    const to = from + WINDOW - 1n < latest ? from + WINDOW - 1n : latest;
    const [ours, payments] = await Promise.all([
      ctx.client.getLogs({ address: [ctx.addresses.tbrl, ctx.addresses.rfq], fromBlock: from, toBlock: to }),
      ctx.client.getLogs({
        address: usd,
        event: memoTransfer,
        args: { to: ctx.addresses.treasury },
        fromBlock: from,
        toBlock: to,
      }),
    ]);
    const events = await toRows(ctx, [...ours, ...payments] as Log[]);
    inserted += await ctx.db.insertChainEvents(events);
    // A fill on-chain closes its invoice, even if the request that sent it never heard back.
    for (const event of events) {
      if (event.event === 'Filled' && event.memoText) await ctx.db.markInvoicePaid(event.memoText);
    }
    await ctx.db.setState(CURSOR, to.toString());
    from = to + 1n;
  }
  return inserted;
}

// The token the RFQ takes payments in: pathUSD on Tempo, whatever it was built with elsewhere.
const paymentTokens = new Map<string, Address>();
async function paymentToken(ctx: Context): Promise<Address> {
  let usd = paymentTokens.get(ctx.addresses.rfq);
  if (!usd) {
    usd = await ctx.client.readContract({ address: ctx.addresses.rfq, abi: rastroRfqAbi, functionName: 'usd' });
    paymentTokens.set(ctx.addresses.rfq, usd);
  }
  return usd;
}

async function startBlock(ctx: Context, latest: bigint) {
  if (process.env.WATCH_FROM_BLOCK) return BigInt(process.env.WATCH_FROM_BLOCK);
  try {
    const tokenTx = loadDeployment(await ctx.client.getChainId()).txs.token;
    if (tokenTx) return (await ctx.client.getTransactionReceipt({ hash: tokenTx })).blockNumber;
  } catch {
    // no deployments file for this chain, or the receipt is gone: fall back
  }
  return latest > BACKFILL ? latest - BACKFILL : 0n;
}

async function toRows(ctx: Context, logs: Log[]): Promise<NewChainEvent[]> {
  const decoded = parseEventLogs({ abi, logs, strict: false });
  const times = new Map<bigint, Date>();
  const timeOf = async (log: (typeof decoded)[number]) => {
    const number = log.blockNumber as bigint;
    if (log.blockTimestamp) return new Date(Number(log.blockTimestamp) * 1000);
    if (!times.has(number)) {
      const block = await ctx.client.getBlock({ blockNumber: number });
      times.set(number, new Date(Number(block.timestamp) * 1000));
    }
    return times.get(number) as Date;
  };

  const rows: NewChainEvent[] = [];
  for (const log of decoded) {
    const args = (log.args ?? {}) as Record<string, unknown>;
    const fields = pick(log.eventName as string, args);
    rows.push({
      txHash: (log.transactionHash as Hash).toLowerCase(),
      logIndex: Number(log.logIndex),
      blockNumber: (log.blockNumber as bigint).toString(),
      blockTime: await timeOf(log),
      contract: log.address.toLowerCase(),
      event: log.eventName as string,
      fromAddress: fields.from?.toLowerCase() ?? null,
      toAddress: fields.to?.toLowerCase() ?? null,
      amount: fields.amount?.toString() ?? null,
      memo: fields.memo ?? null,
      memoText: fields.memo ? printable(fields.memo) : null,
      args: jsonSafe(args),
    });
  }
  return rows;
}

function pick(event: string, args: Record<string, unknown>) {
  const a = args as Record<string, string | bigint | undefined>;
  switch (event) {
    case 'Transfer':
    case 'TransferWithMemo':
      return { from: a.from as string, to: a.to as string, amount: a.amount as bigint, memo: a.memo as Hex | undefined };
    case 'Mint':
      return { to: a.to as string, amount: a.amount as bigint };
    case 'Burn':
      return { from: a.from as string, amount: a.amount as bigint };
    case 'Filled':
      return { from: a.payer as string, to: a.recipient as string, amount: a.brlOut as bigint, memo: a.invoiceRef as Hex };
    default:
      return {} as { from?: string; to?: string; amount?: bigint; memo?: Hex };
  }
}

// The memo as text when it is text, as Rastro writes it; null for anything else.
function printable(memo: Hex): string | null {
  try {
    const text = hexToString(memo, { size: 32 }).replace(/\0+$/, '');
    return /^[\x20-\x7e]+$/.test(text) ? text : null;
  } catch {
    return null;
  }
}

function jsonSafe(args: Record<string, unknown>) {
  return Object.fromEntries(Object.entries(args).map(([key, value]) => [key, typeof value === 'bigint' ? value.toString() : value]));
}
