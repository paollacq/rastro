import { AppError, testTransfer } from '@rastro/core';
import { context, handle, readJson, requireAdmin } from '../../../../lib/api';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

// { wallet, amountBrl? } -> tries to send tBRL from the treasury to that wallet. Outside the
// policy the chain refuses it and the attempt is recorded for the console.
export async function POST(request: Request) {
  return handle(async () => {
    requireAdmin(request);
    const { wallet, amountBrl } = await readJson(request);
    if (typeof wallet !== 'string') throw new AppError(400, 'falta wallet', 'bad_request');
    return testTransfer(context(), { wallet, amountBrl: typeof amountBrl === 'string' ? amountBrl : undefined });
  });
}
