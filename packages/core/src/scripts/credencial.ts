// The PayZu sandbox credential lasts 24 hours. This is the five seconds of work after
// generating a new one, and the way to find out whether the current one is still alive.
//
//   pnpm pix:credencial                                  is the token alive, and what does it back
//   pnpm pix:credencial https://<app>/api/webhooks/pix   also registers the webhook and prints its secret
//
// A new credential comes with a fresh R$ 10.000,00 and no memory of the old one, so the
// tBRL in circulation has to be squared with it: the last line says whether to run
// `pnpm demo:reset`.
import { PayZu, PayZuError } from '@rastro/pix';
import { createContext } from '../context.ts';
import { clearCredentialFlag, credentialExpired } from '../pix-mode.ts';
import { readReserves } from '../reserves.ts';

const NEW_ONE = 'https://docs.payzu.com.br/docs/pix-processamento/sandbox/credencial';
const url = process.argv[2];
if (url && !url.startsWith('https://')) {
  console.error('uso: pnpm pix:credencial [https://<endereço público>/api/webhooks/pix]');
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
      ? `a credencial não vale mais (${error.status}). Gere outra em\n  ${NEW_ONE}\ne ponha em PAYZU_TOKEN, aqui e no deploy.`
      : `o sandbox não respondeu: ${error instanceof Error ? error.message : error}`,
  );
  await ctx.db.sql.end();
  process.exit(1);
}

console.log(`credencial  viva, saldo R$ ${balance.balanceAvailable.toFixed(2)}, bloqueado R$ ${balance.balanceBlocked.toFixed(2)}`);
if (await credentialExpired(ctx)) {
  await clearCredentialFlag(ctx);
  console.log('            o app tinha caído para o simulador; voltou para o sandbox');
}

if (url) {
  const existing = (await api.webhooks()).find((hook) => hook.url === url);
  if (existing) {
    console.log(`webhook     já registrado (${existing.id}), segredo ${existing.hasSecret ? 'definido' : 'faltando'}`);
  } else {
    const created = await api.createWebhook(url);
    console.log(`webhook     registrado ${created.id}\n\nPAYZU_WEBHOOK_SECRET=${created.secret}\n\nO segredo aparece só desta vez: ponha no app e no worker.`);
  }
  console.log('            confira a posse com pnpm pix:webhook ' + url);
}

// A credential is only useful if the tBRL in circulation fits behind it.
try {
  const reserves = await readReserves(ctx);
  const supply = (Number(reserves.supply) / 1e6).toFixed(2);
  console.log(`lastro      R$ ${supply} em tBRL contra R$ ${reserves.balanceBrl} no sandbox`);
  console.log(reserves.ok ? '\nTudo certo.' : `\nFaltam R$ ${reserves.shortfallBrl} de lastro: rode pnpm demo:reset antes da demo.`);
} catch (error) {
  console.log(`lastro      não deu para ler agora: ${error instanceof Error ? error.message : error}`);
}
await ctx.db.sql.end();
