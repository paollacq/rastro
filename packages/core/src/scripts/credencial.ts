// The PayZu sandbox credential lasts 24 hours. This is the five seconds of work after
// generating a new one, and the way to find out whether the current one is still alive.
//
//   pnpm pix:credencial                                  is the token alive, and what does it back
//   pnpm pix:credencial https://<app>/api/webhooks/pix   also registers the webhook and prints its secret
//
// A new credential comes with a fresh R$ 10,000.00 and no memory of the old one, so the
// tBRL in circulation has to be squared with it: the last line says whether to run
// `pnpm demo:reset`.
import { PayZu, PayZuError } from '@rastro/pix';
import { createContext } from '../context.ts';
import { clearCredentialFlag, credentialExpired } from '../pix-mode.ts';
import { readReserves } from '../reserves.ts';

const NEW_ONE = 'https://docs.payzu.com.br/docs/pix-processamento/sandbox/credencial';
const url = process.argv[2];
if (url && !url.startsWith('https://')) {
  console.error('usage: pnpm pix:credencial [https://<public address>/api/webhooks/pix]');
  process.exit(1);
}

const ctx = createContext();
const api = PayZu.fromEnv();

let balance: { balanceAvailable: number; balanceBlocked: number };
try {
  balance = await api.balance();
} catch (error) {
  const expired = error instanceof PayZuError && (error.status === 401 || error.status === 403);
  console.log(
    expired
      ? `the credential is no longer valid (${error.status}). Generate another at\n  ${NEW_ONE}\nand put it in PAYZU_TOKEN, here and on the deploy.`
      : `the sandbox didn't respond: ${error instanceof Error ? error.message : error}`,
  );
  await ctx.db.sql.end();
  process.exit(1);
}

console.log(`credential  alive, balance R$ ${balance.balanceAvailable.toFixed(2)}, blocked R$ ${balance.balanceBlocked.toFixed(2)}`);
if (await credentialExpired(ctx)) {
  await clearCredentialFlag(ctx);
  console.log('            the app had fallen back to the simulator; switched back to the sandbox');
}

if (url) {
  const existing = (await api.webhooks()).find((hook) => hook.url === url);
  if (existing) {
    console.log(`webhook     already registered (${existing.id}), secret ${existing.hasSecret ? 'set' : 'missing'}`);
  } else {
    const created = await api.createWebhook(url);
    console.log(`webhook     registered ${created.id}\n\nPAYZU_WEBHOOK_SECRET=${created.secret}\n\nThe secret only shows up this once: put it on the app and the worker.`);
  }
  console.log('            verify ownership with pnpm pix:webhook ' + url);
}

// A credential is only useful if the tBRL in circulation fits behind it.
try {
  const reserves = await readReserves(ctx);
  const supply = (Number(reserves.supply) / 1e6).toFixed(2);
  console.log(`backing     R$ ${supply} in tBRL vs R$ ${reserves.balanceBrl} at the sandbox`);
  console.log(reserves.ok ? '\nAll good.' : `\nShort by R$ ${reserves.shortfallBrl} of backing: run pnpm demo:reset before the demo.`);
} catch (error) {
  console.log(`backing     couldn't read now: ${error instanceof Error ? error.message : error}`);
}
await ctx.db.sql.end();
