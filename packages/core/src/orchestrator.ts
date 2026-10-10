import { textMemo } from '@rastro/chain';
import type { User, Withdrawal } from '@rastro/db';
import { PayZuError } from '@rastro/pix';
import { encodeFunctionData, keccak256, toHex, type Hash, type Hex } from 'viem';
import { Abis } from 'viem/tempo';
import type { Context } from './context.ts';
import { shortError } from './errors.ts';
import { baseToBrl } from './money.ts';
import { settle, signAndSend, waitBriefly } from './tx.ts';

// The withdrawal state machine. Each tick moves every open withdrawal as far as it can.
// What keeps money from moving twice:
//   - one orchestrator at a time, through a lease row in Postgres;
//   - the Pix provider is asked for the reference before anything is sent, and both
//     providers refuse a second withdrawal with the same reference;
//   - transfers, burns and refunds are signed, saved and then broadcast (tx.ts), and the
//     chain is checked for one with the same memo before a new one is signed;
//   - once the Pix is confirmed the only way forward is the burn. Never a refund.

const LEASE = 'orchestrator';
const LEASE_SECONDS = 120;
const MAX_STEPS = 8;
const ORPHAN_MS = 2 * 60_000;

export async function tick(ctx: Context): Promise<number> {
  if (!(await ctx.db.acquireLease(LEASE, ctx.instanceId, LEASE_SECONDS))) return 0;
  let moved = 0;
  for (const withdrawal of await ctx.db.openWithdrawals()) {
    // Renewed per withdrawal: a slow RPC can't let the lease lapse mid-tick.
    if (!(await ctx.db.acquireLease(LEASE, ctx.instanceId, LEASE_SECONDS))) break;
    try {
      let current: Withdrawal | null = withdrawal;
      for (let i = 0; current && i < MAX_STEPS; i++) {
        current = await advanceOnce(ctx, current);
        if (current) moved++;
      }
    } catch (error) {
      ctx.log(`${withdrawal.id} (${withdrawal.status}): ${shortError(error)}`);
    }
  }
  return moved;
}

export const releaseOrchestrator = (ctx: Context) => ctx.db.releaseLease(LEASE, ctx.instanceId);

// The memo of the burn: the Pix ID itself when it fits, which it does for both the official
// 32-character format and the sandbox's 20, or its hash otherwise.
export function burnMemo(endToEndId: string): Hex {
  try {
    return textMemo(endToEndId);
  } catch {
    return keccak256(toHex(endToEndId));
  }
}

export const refundMemoText = (withdrawalId: string) => `devolucao ${withdrawalId}`;

// Returns the withdrawal after a status change, or null when it has to wait.
async function advanceOnce(ctx: Context, w: Withdrawal): Promise<Withdrawal | null> {
  const user = await ctx.db.user(w.userId);
  if (!user) throw new Error(`user ${w.userId} is gone`);
  const { tbrl, treasury } = ctx.addresses;

  switch (w.status) {
    case 'SOLICITADO': {
      const arrived = await ctx.db.findMemoTransfer({ contract: tbrl, from: user.wallet, to: treasury, memoText: w.id });
      if (arrived) {
        return ctx.db.advance(w.id, 'SOLICITADO', 'TBRL_NA_TESOURARIA', { transferTx: arrived.txHash }, `tBRL na tesouraria, bloco ${arrived.blockNumber}`);
      }
      if (w.transferTx) {
        // We signed it ourselves for this amount, so its receipt is enough.
        const state = await settle(ctx, w.transferTx as Hash);
        if (state === 'success') return ctx.db.advance(w.id, 'SOLICITADO', 'TBRL_NA_TESOURARIA', {}, 'tBRL na tesouraria');
        if (state === 'reverted' || state === 'dead') {
          return ctx.db.advance(w.id, 'SOLICITADO', 'CANCELADO', { failure: `transferência ${state === 'dead' ? 'descartada' : 'revertida'}` }, 'o tBRL não saiu da carteira');
        }
        return null;
      }
      if (ctx.now().getTime() - w.createdAt.getTime() > ORPHAN_MS) {
        return ctx.db.advance(w.id, 'SOLICITADO', 'CANCELADO', { failure: 'transferência não assinada' }, 'o pedido não chegou a enviar o tBRL');
      }
      return null;
    }

    case 'TBRL_NA_TESOURARIA': {
      const pix = ctx.pix;
      let sent = await pix.findWithdrawal(w.id);
      if (!sent) {
        try {
          sent = await pix.createWithdrawal({
            amountBrl: baseToBrl(BigInt(w.amountBrl)),
            pixKey: requirePixKey(user),
            pixKeyType: user.pixKeyType ?? 'email',
            reference: w.id,
          });
        } catch (error) {
          // 409: someone created it between our lookup and our request. 400/422: refused
          // for good (bad key, limits); the tBRL goes back. Anything else: try again later.
          if (error instanceof PayZuError && error.status === 409) sent = await pix.findWithdrawal(w.id);
          else if (error instanceof PayZuError && (error.status === 400 || error.status === 422)) {
            const failure = `Pix recusado: ${error.body.slice(0, 120)}`;
            return ctx.db.advance(w.id, 'TBRL_NA_TESOURARIA', 'FALHOU', { failure }, failure);
          } else throw error;
        }
      }
      if (!sent) return null;
      return ctx.db.advance(
        w.id,
        'TBRL_NA_TESOURARIA',
        'PIX_ENVIADO',
        { provider: pix.name, providerId: sent.id },
        `Pix de R$ ${sent.amountBrl} pedido (${pix.name === 'simulator' ? 'simulador' : 'sandbox PayZu'})`,
      );
    }

    case 'PIX_ENVIADO': {
      // A verified event for this very transaction settles it; without one, ask the
      // provider it was sent through, even if PIX_MODE changed since.
      const events = (await ctx.db.pixEvents({ reference: w.id })).filter(
        (event) => !w.providerId || event.providerTxId === w.providerId,
      );
      const completed = events.find((event) => event.status === 'COMPLETED' && event.e2eId);
      const failed = events.find((event) => event.status && ['CANCELED', 'ERROR', 'EXPIRED'].includes(event.status));
      let endToEndId = completed?.e2eId ?? null;
      let failure = !completed && failed ? `Pix ${failed.status}` : null;

      if (!endToEndId && !failure) {
        const now = await ctx.pixFor(w.provider ?? ctx.pix.name).findWithdrawal(w.id);
        if (now?.status === 'COMPLETED' && now.endToEndId) endToEndId = now.endToEndId;
        else if (now?.status === 'FAILED') failure = `Pix ${now.providerStatus}`;
        else return null;
      }
      if (endToEndId) {
        return ctx.db.advance(w.id, 'PIX_ENVIADO', 'PIX_CONFIRMADO', { e2eId: endToEndId }, `Pix confirmado: ${endToEndId}`);
      }
      return ctx.db.advance(w.id, 'PIX_ENVIADO', 'FALHOU', { failure }, failure ?? 'Pix recusado');
    }

    case 'PIX_CONFIRMADO': {
      const endToEndId = w.e2eId as string;
      const memo = burnMemo(endToEndId);
      const state = await once(ctx, w, 'burnTx', endToEndId, {
        to: tbrl,
        data: encodeFunctionData({ abi: Abis.tip20, functionName: 'burnWithMemo', args: [BigInt(w.amountBrl), memo] }),
      });
      if (state !== 'success') return null;
      const burned = await ctx.db.advance(w.id, 'PIX_CONFIRMADO', 'QUEIMADO', {}, 'tBRL queimado com o ID do Pix no memo');
      return burned && ctx.db.advance(w.id, 'QUEIMADO', 'CONCLUIDO', {}, 'concluído');
    }

    case 'QUEIMADO':
      return ctx.db.advance(w.id, 'QUEIMADO', 'CONCLUIDO', {}, 'concluído');

    case 'FALHOU': {
      const memoText = refundMemoText(w.id);
      const state = await once(ctx, w, 'refundTx', memoText, {
        to: tbrl,
        data: encodeFunctionData({
          abi: Abis.tip20,
          functionName: 'transferWithMemo',
          args: [user.wallet as Hex, BigInt(w.amountBrl), textMemo(memoText)],
        }),
      });
      if (state !== 'success') return null;
      return ctx.db.advance(w.id, 'FALHOU', 'DEVOLVIDO', {}, 'tBRL devolvido à carteira');
    }

    default:
      return null;
  }
}

// A treasury transaction that happens once per withdrawal. Uses the hash already saved,
// or one the watcher saw with the same memo, before signing a new one; a saved hash is
// only dropped when the chain says it can never land.
async function once(
  ctx: Context,
  w: Withdrawal,
  field: 'burnTx' | 'refundTx',
  memoText: string,
  call: { to: Hex; data: Hex },
): Promise<'success' | 'pending'> {
  let hash = w[field] as Hash | null;
  if (!hash) {
    const seen = await ctx.db.findMemoSent({ contract: ctx.addresses.tbrl, from: ctx.addresses.treasury, memoText });
    if (seen) {
      hash = seen.txHash as Hash;
      await ctx.db.patchWithdrawal(w.id, { [field]: hash });
    }
  }
  if (hash) {
    const state = await settle(ctx, hash);
    if (state === 'success') return 'success';
    if (state === 'reverted' || state === 'dead') {
      await ctx.db.patchWithdrawal(w.id, { [field]: null });
      ctx.log(`${w.id}: ${field} ${hash} ${state}; it will be signed again`);
    }
    return 'pending';
  }
  const sent = await signAndSend(ctx, 'treasury', call, { withdrawalId: w.id, kind: field === 'burnTx' ? 'burn' : 'refund' }, (h) =>
    ctx.db.patchWithdrawal(w.id, { [field]: h }),
  );
  return (await waitBriefly(ctx, sent)) === 'success' ? 'success' : 'pending';
}

function requirePixKey(user: User) {
  if (!user.pixKey) throw new Error(`${user.id} has no Pix key`);
  return user.pixKey;
}
