import { createQuote } from '@rastro/core';
import { context, handle, readJson } from '../../../lib/api';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

// { invoiceId } -> a quote signed by the quoter, valid for 30 s, with the PTAX it used.
export async function POST(request: Request) {
  return handle(async () => {
    const { invoiceId } = await readJson(request);
    return createQuote(context(), typeof invoiceId === 'string' ? invoiceId : 'fatura-0047');
  });
}
