import { AppError } from '@rastro/core';
import { context, handle, readJson } from '../../../lib/api';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

// { autoWithdraw: true } -> payments Ana receives from now on go out by Pix on their own.
export async function POST(request: Request) {
  return handle(async () => {
    const { autoWithdraw } = await readJson(request);
    if (typeof autoWithdraw !== 'boolean') throw new AppError(400, 'falta autoWithdraw: true ou false', 'bad_request');
    const user = await context().db.setAutoWithdraw('ana', autoWithdraw);
    return { autoWithdraw: user?.autoWithdrawSince != null, since: user?.autoWithdrawSince ?? null };
  });
}
