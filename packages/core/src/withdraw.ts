import { textMemo } from '@rastro/chain';
import { encodeFunctionData, isAddressEqual, type Hash, type Hex } from 'viem';
import { Abis } from 'viem/tempo';
import type { Context } from './context.ts';
import { AppError, notFound, shortError } from './errors.ts';
import { baseToBrl, brlToBase, newId } from './money.ts';
import { signAndSend } from './tx.ts';

// Ana asks for reais. The withdrawal id doubles as the memo of her tBRL transfer to the
// treasury, so the watcher can tell which withdrawal a transfer belongs to.
export async function requestWithdrawal(
  ctx: Context,
  input: { userId: string; amountBrl: string; invoiceId?: string | null },
): Promise<{ id: string; transferTx: Hash }> {
  const user = await ctx.db.user(input.userId);
  if (!user) throw notFound('usuária');
  if (!user.pixKey) throw new AppError(400, 'cadastre uma chave Pix antes de sacar');

  let amount: bigint;
  try {
    amount = brlToBase(input.amountBrl);
  } catch {
    throw new AppError(400, 'valor inválido: use reais com até dois centavos, como 8274.42');
  }
  if (amount <= 0n) throw new AppError(400, 'o valor precisa ser maior que zero');

  // Demo custody: the server signs for the wallet in ANA_PRIVATE_KEY and no other.
  const ana = ctx.signer('ana');
  if (!isAddressEqual(ana.account.address, user.wallet as Hex)) {
    throw new AppError(403, 'esta demo só assina pela carteira de ANA_PRIVATE_KEY');
  }

  const balance = await ctx.client.readContract({
    address: ctx.addresses.tbrl,
    abi: Abis.tip20,
    functionName: 'balanceOf',
    args: [ana.account.address],
  });
  if (balance < amount) throw new AppError(409, `saldo insuficiente: R$ ${baseToBrl(balance - (balance % 10_000n))}`);

  const id = newId('saque');
  await ctx.db.insertWithdrawal(
    { id, userId: user.id, invoiceId: input.invoiceId ?? null, amountBrl: amount.toString() },
    `R$ ${baseToBrl(amount)} para ${user.pixKeyMasked ?? 'a chave cadastrada'}`,
  );

  try {
    const transferTx = await signAndSend(
      ctx,
      'ana',
      {
        to: ctx.addresses.tbrl,
        data: encodeFunctionData({
          abi: Abis.tip20,
          functionName: 'transferWithMemo',
          args: [ctx.addresses.treasury, amount, textMemo(id)],
        }),
      },
      { withdrawalId: id, kind: 'transfer' },
      (hash) => ctx.db.patchWithdrawal(id, { transferTx: hash }),
    );
    return { id, transferTx };
  } catch (error) {
    const saved = await ctx.db.withdrawal(id);
    if (saved?.transferTx) {
      // Signed and saved, just not broadcast: the worker pushes it again or cancels it once
      // its nonce has gone to something else.
      ctx.log(`${id}: broadcast failed (${shortError(error)}); the worker will retry it`);
      return { id, transferTx: saved.transferTx as Hash };
    }
    await ctx.db.advance(id, 'SOLICITADO', 'CANCELADO', { failure: shortError(error) }, 'o tBRL não saiu da carteira');
    throw new AppError(502, `não deu para enviar o tBRL: ${shortError(error)}`);
  }
}
