import type { OutboxTx } from '@rastro/db';
import { keccak256, type Address, type Hash, type Hex } from 'viem';
import type { Context, Role } from './context.ts';
import { shortError } from './errors.ts';

// Money-moving transactions are signed first, saved, and only then broadcast. Whatever
// dies afterwards (the broadcast, the process, the RPC), the next attempt pushes the same
// bytes again: same hash, same nonce. A step is never signed twice unless its nonce has
// already gone to another transaction, which means this one can never land.

export type TxState = 'success' | 'reverted' | 'pending' | 'dead';

export async function signAndSend(
  ctx: Context,
  role: Role,
  call: { to: Address; data: Hex },
  meta: { withdrawalId: string | null; kind: OutboxTx['kind'] },
  remember: (hash: Hash) => Promise<void>,
): Promise<Hash> {
  const { wallet, account } = ctx.signer(role);
  const request = await wallet.prepareTransactionRequest({ to: call.to, data: call.data } as never);
  const raw = (await wallet.signTransaction(request as never)) as Hex;
  const hash = keccak256(raw);
  await ctx.db.insertOutbox({
    hash,
    withdrawalId: meta.withdrawalId,
    kind: meta.kind,
    signer: account.address.toLowerCase(),
    nonce: Number((request as { nonce: number }).nonce),
    raw,
  });
  await remember(hash);
  await push(ctx, raw);
  return hash;
}

// Where a transaction stands. Pending ones get pushed again on the way.
export async function settle(ctx: Context, hash: Hash): Promise<TxState> {
  const receipt = await ctx.client.getTransactionReceipt({ hash }).catch(() => null);
  if (receipt) return receipt.status === 'success' ? 'success' : 'reverted';

  const saved = await ctx.db.outbox(hash);
  if (!saved) return 'pending';
  const used = await ctx.client.getTransactionCount({ address: saved.signer as Address, blockTag: 'latest' });
  if (used > Number(saved.nonce)) {
    const late = await ctx.client.getTransactionReceipt({ hash }).catch(() => null);
    if (late) return late.status === 'success' ? 'success' : 'reverted';
    return 'dead';
  }
  await push(ctx, saved.raw as Hex).catch((error) => ctx.log(`rebroadcast ${hash}: ${shortError(error)}`));
  return 'pending';
}

// Waits a little for a transaction just sent, so the demo doesn't sit a whole tick idle.
export async function waitBriefly(ctx: Context, hash: Hash, ms = 20_000): Promise<TxState> {
  try {
    const receipt = await ctx.client.waitForTransactionReceipt({ hash, timeout: ms });
    return receipt.status === 'success' ? 'success' : 'reverted';
  } catch {
    return settle(ctx, hash);
  }
}

// A contract call that is not part of the withdrawal's money path: the policy, the pause,
// the deliberate mint of the demo. Plain transactions, so the same code runs on Tempo and on
// a local EVM, and the receipt is checked before anything else happens.
export async function writeAndWait(
  ctx: Context,
  role: Role,
  request: { address: Address; abi: unknown; functionName: string; args: readonly unknown[] },
  what: string,
): Promise<Hash> {
  const { wallet } = ctx.signer(role);
  const hash = (await wallet.writeContract(request as never)) as Hash;
  const receipt = await ctx.client.waitForTransactionReceipt({ hash });
  if (receipt.status !== 'success') throw new Error(`${what} reverteu: ${hash}`);
  return hash;
}

async function push(ctx: Context, raw: Hex) {
  try {
    await ctx.client.sendRawTransaction({ serializedTransaction: raw });
  } catch (error) {
    // Already in the pool, or already mined: settle() will tell which.
    if (/already known|known transaction|nonce too low|already imported/i.test(shortError(error))) return;
    throw error;
  }
}
