import { AppError, requestWithdrawal } from '@rastro/core';
import { context, handle, readJson } from '../../../lib/api';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

// { amountBrl: "8274.42", invoiceId? } -> Ana's tBRL goes to the treasury with the
// withdrawal id as memo; the worker takes it from there. Returns the id to follow.
export async function POST(request: Request) {
  return handle(async () => {
    const { amountBrl, invoiceId } = await readJson(request);
    if (typeof amountBrl !== 'string') throw new AppError(400, 'falta amountBrl, como "8274.42"');
    return requestWithdrawal(context(), {
      userId: 'ana',
      amountBrl,
      invoiceId: typeof invoiceId === 'string' ? invoiceId : null,
    });
  });
}
