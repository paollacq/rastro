import { AppError, clearCredentialFlag, effectivePixMode, markCredentialExpired } from '@rastro/core';
import { context, handle, readJson, requireAdmin } from '../../../../lib/api';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

// { mode: "sandbox" | "simulator" }. Switching to the simulator is what the worker does by
// itself when the sandbox credential stops working; this is the manual lever, for a
// recording or for after a new credential is in place.
export async function POST(request: Request) {
  return handle(async () => {
    requireAdmin(request);
    const { mode } = await readJson(request);
    const ctx = context();
    if (mode === 'simulator') await markCredentialExpired(ctx, 'switched in admin');
    else if (mode === 'sandbox') await clearCredentialFlag(ctx);
    else throw new AppError(400, 'mode must be "sandbox" or "simulator"', 'bad_request');
    return { mode: await effectivePixMode(ctx) };
  });
}
