import { explorer, textMemo, tip403Registry } from '@rastro/chain';
import { BaseError, ContractFunctionRevertedError, getAddress, isAddress, type Hash } from 'viem';
import { Abis } from 'viem/tempo';
import type { Context } from './context.ts';
import { AppError } from './errors.ts';
import { baseToBrl, brlToBase, floorToCents } from './money.ts';

// The policy, seen from outside: Ana tries to send a little of her tBRL to another wallet.
// If that wallet is not on the TIP-403 whitelist the chain refuses it, before any block and
// without spending gas, and the refusal is written to blocked_attempts for the console. The
// same transfer after the other side's cadastro goes through. That contrast is the demo.

const MOST = brlToBase('10.00');
const MEMO = 'rastro:teste';

export interface PolicyTest {
  from: string;
  wallet: string;
  amountBrl: string;
  identified: boolean;
  allowed: boolean;
  reason: string | null;
  txHash: string | null;
  policyId: string;
  explorer: string;
}

export async function testTransfer(ctx: Context, input: { wallet: string; amountBrl?: string }): Promise<PolicyTest> {
  if (!isAddress(input.wallet)) {
    throw new AppError(400, 'invalid wallet: 42 characters starting with 0x', 'invalid_wallet');
  }
  const wallet = getAddress(input.wallet);
  const { policyId } = ctx.addresses;
  if (policyId === undefined) {
    throw new AppError(409, 'no TIP-403 policy configured; run pnpm chain:setup', 'no_policy');
  }

  let amount: bigint;
  try {
    amount = floorToCents(brlToBase(input.amountBrl ?? '1.00'));
  } catch {
    throw new AppError(400, 'invalid amount: use reais with up to two cents, like 1.00', 'invalid_amount');
  }
  if (amount <= 0n) throw new AppError(400, 'o valor precisa ser maior que zero', 'invalid_amount');
  if (amount > MOST) {
    throw new AppError(400, `this test sends at most R$ ${baseToBrl(MOST)}`, 'invalid_amount');
  }

  const identified = await ctx.client.readContract({
    address: tip403Registry,
    abi: Abis.tip403Registry,
    functionName: 'isAuthorized',
    args: [policyId, wallet],
  });

  // From the demo client's own wallet: a person sending their reais to someone else is the
  // transfer the policy exists for.
  const { account } = ctx.signer('ana');
  const held = await ctx.client.readContract({
    address: ctx.addresses.tbrl,
    abi: Abis.tip20,
    functionName: 'balanceOf',
    args: [account.address],
  });
  if (held < amount) {
    throw new AppError(
      409,
      `the demo wallet holds R$ ${baseToBrl(floorToCents(held))} in tBRL; pay invoice #0047 before testing the policy`,
      'insufficient_balance',
    );
  }

  const call = {
    account,
    address: ctx.addresses.tbrl,
    abi: Abis.tip20,
    functionName: 'transferWithMemo',
    args: [wallet, amount, textMemo(MEMO)],
  } as const;

  // The node runs the policy here, with no transaction and no gas spent.
  try {
    await ctx.client.simulateContract(call as never);
  } catch (error) {
    const name = revertName(error);
    // Only a policy refusal is a blocked attempt. Anything else is our own problem.
    if (name !== 'PolicyForbids' && name !== 'InvalidRecipient') {
      const how = name === 'ContractPaused' ? 'tBRL is paused' : `the test transfer did not go through: ${name}`;
      throw new AppError(409, how, name === 'ContractPaused' ? 'paused' : 'test_failed');
    }
    const reason = `wallet not on policy ${policyId} (identified wallets); the node refused with ${name}`;
    await ctx.db.insertBlockedAttempt({
      fromAddress: account.address.toLowerCase(),
      toAddress: wallet.toLowerCase(),
      amount: amount.toString(),
      reason,
    });
    ctx.log(`policy ${policyId} refused R$ ${baseToBrl(amount)} in tBRL to ${wallet}`);
    return {
      from: account.address,
      wallet,
      amountBrl: baseToBrl(amount),
      identified,
      allowed: false,
      reason,
      txHash: null,
      policyId: policyId.toString(),
      explorer,
    };
  }

  // Allowed: send it for real, so there is a transaction to open in the explorer.
  const { wallet: ana } = ctx.signer('ana');
  const hash = (await ana.writeContract(call as never)) as Hash;
  const receipt = await ctx.client.waitForTransactionReceipt({ hash });
  if (receipt.status !== 'success') {
    throw new AppError(502, `the test transfer reverted: ${hash}`, 'reverted');
  }
  return {
    from: account.address,
    wallet,
    amountBrl: baseToBrl(amount),
    identified,
    allowed: true,
    reason: null,
    txHash: hash,
    policyId: policyId.toString(),
    explorer,
  };
}

// What the chain called it: the custom error's name when there is one (PolicyForbids on a
// TIP-20), otherwise viem's one-line summary.
function revertName(error: unknown): string {
  if (error instanceof BaseError) {
    const reverted = error.walk((e) => e instanceof ContractFunctionRevertedError);
    if (reverted instanceof ContractFunctionRevertedError) {
      return reverted.data?.errorName ?? reverted.reason ?? reverted.shortMessage;
    }
    return error.shortMessage;
  }
  return error instanceof Error ? error.message.split('\n')[0] : String(error);
}
