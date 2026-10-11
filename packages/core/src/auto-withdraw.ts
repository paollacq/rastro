import { Abis } from 'viem/tempo';
import type { Address } from 'viem';
import type { Context } from './context.ts';
import { AppError, shortError } from './errors.ts';
import { baseToBrl, floorToCents } from './money.ts';
import { requestWithdrawal } from './withdraw.ts';

// "Sacar automaticamente por Pix": once Ana turns it on, every invoice paid after that goes
// out on the worker's next pass, through the same path as the button. One try per invoice;
// if the Pix fails, the money comes back and the button is there again.
export async function autoWithdraw(ctx: Context): Promise<number> {
  let started = 0;
  for (const due of await ctx.db.autoWithdrawDue()) {
    const user = await ctx.db.user(due.userId);
    if (!user) continue;
    try {
      const balance = await ctx.client.readContract({
        address: ctx.addresses.tbrl,
        abi: Abis.tip20,
        functionName: 'balanceOf',
        args: [user.wallet as Address],
      });
      // Less than the payment if part of it already left by other means.
      const amount = floorToCents(BigInt(due.brlOut) < balance ? BigInt(due.brlOut) : balance);
      if (amount === 0n) continue;
      const { id } = await requestWithdrawal(ctx, { userId: user.id, amountBrl: baseToBrl(amount), invoiceId: due.invoiceId });
      ctx.log(`${id}: automatic withdrawal of ${due.invoiceId}, R$ ${baseToBrl(amount)}`);
      started++;
    } catch (error) {
      // 409: the button got there first. Anything else waits for the next pass.
      if (!(error instanceof AppError && error.status === 409)) {
        ctx.log(`automatic withdrawal of ${due.invoiceId} failed: ${shortError(error)}`);
      }
    }
  }
  return started;
}
