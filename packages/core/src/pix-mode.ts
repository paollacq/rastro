import type { PixProvider } from '@rastro/pix';
import { PayZuError } from '@rastro/pix';
import { pixMode, type Context } from './context.ts';

// The PayZu sandbox credential lasts 24 hours and does not renew. When it stops working,
// the app doesn't stop: it falls back to our own simulator, says so on every screen, and
// keeps the sandbox for withdrawals already sent through it. A new credential in the
// environment plus `pnpm pix:credencial` clears the flag.

const KEY = 'pix_credential';

export type PixMode = 'sandbox' | 'simulator';

export async function credentialExpired(ctx: Context): Promise<boolean> {
  return (await ctx.db.state(KEY)) === 'expired';
}

export async function markCredentialExpired(ctx: Context, why: string): Promise<void> {
  if (await credentialExpired(ctx)) return;
  await ctx.db.setState(KEY, 'expired');
  ctx.log(`PayZu credential stopped working (${why}); new withdrawals go through the simulator`);
}

export async function clearCredentialFlag(ctx: Context): Promise<void> {
  await ctx.db.setState(KEY, 'ok');
}

// What a new withdrawal goes through right now. An older one keeps its own provider.
export async function activePix(ctx: Context): Promise<PixProvider> {
  if (ctx.pix.name !== 'payzu-sandbox') return ctx.pix;
  return (await credentialExpired(ctx)) ? ctx.pixFor('simulator') : ctx.pix;
}

export async function effectivePixMode(ctx: Context): Promise<PixMode> {
  if (pixMode() === 'simulator') return 'simulator';
  return (await credentialExpired(ctx)) ? 'simulator' : 'sandbox';
}

// 401 and 403 are the credential; anything else is the sandbox having a bad minute.
export function isCredentialError(error: unknown): boolean {
  return error instanceof PayZuError && (error.status === 401 || error.status === 403);
}
