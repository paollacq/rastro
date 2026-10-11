import { AppError, breakReserve, monitorReserves, restoreReserve } from '@rastro/core';
import { context, handle, readJson, requireAdmin } from '../../../../lib/api';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

// { action: "check" | "break" | "restore", amountBrl? }. "break" mints tBRL with nothing
// behind it, for the technical demo; the monitor pauses the token on its next round.
export async function POST(request: Request) {
  return handle(async () => {
    requireAdmin(request);
    const { action, amountBrl } = await readJson(request);
    const ctx = context();
    switch (action) {
      case 'check':
        return { action, reading: await monitorReserves(ctx, true) };
      case 'break':
        return { action, ...(await breakReserve(ctx, typeof amountBrl === 'string' ? amountBrl : undefined)) };
      case 'restore':
        return { action, ...(await restoreReserve(ctx)) };
      default:
        throw new AppError(400, 'action precisa ser "check", "break" ou "restore"', 'bad_request');
    }
  });
}
