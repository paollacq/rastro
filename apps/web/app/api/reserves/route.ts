import { reservesView } from '@rastro/core';
import { context, handle } from '../../../lib/api';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

// tBRL supply against the reais in the Pix account, and whether the first still fits in
// the second.
export async function GET() {
  return handle(() => reservesView(context()));
}
