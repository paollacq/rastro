import { AppError, payQuote } from '@rastro/core';
import { context, handle, readJson } from '../../../lib/api';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

// { quoteId } -> the demo payer approves and fills in one Tempo transaction.
export async function POST(request: Request) {
  return handle(async () => {
    const { quoteId } = await readJson(request);
    if (typeof quoteId !== 'string') throw new AppError(400, 'falta quoteId');
    return payQuote(context(), quoteId);
  });
}
