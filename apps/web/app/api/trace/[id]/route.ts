import { notFound, trace } from '@rastro/core';
import { context, handle } from '../../../../lib/api';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

// /api/trace/fatura-0047 or /api/trace/saque-k3j9x2m1 -> the whole trail.
export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  return handle(async () => {
    const { id } = await params;
    const found = await trace(context(), id);
    if (!found) throw notFound('rastro');
    return found;
  });
}
