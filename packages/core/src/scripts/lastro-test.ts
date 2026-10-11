// The reserve demo, end to end, without the browser: break the backing on purpose, watch
// the monitor pause the token, then restore it.
//
//   pnpm lastro:test                 R$ 1.000,00 with nothing behind it
//   pnpm lastro:test --brl 50.00
//   pnpm lastro:test --keep          leaves it broken and paused, for a recording
import { explorer } from '@rastro/chain';
import { parseArgs } from 'node:util';
import { createContext } from '../context.ts';
import { AppError } from '../errors.ts';
import { breakReserve, isPaused, monitorReserves, restoreReserve } from '../reserves.ts';

const { values: opts } = parseArgs({
  options: { brl: { type: 'string', default: '1000.00' }, keep: { type: 'boolean', default: false } },
});

const ctx = createContext();
const link = (hash: string | null | undefined) => (hash ? `  ${explorer}/tx/${hash}` : '');

const before = await monitorReserves(ctx, true);
if (!before) throw new Error('could not read the reserves');
console.log(`before    R$ ${before.supplyBrl} in tBRL against R$ ${before.balanceBrl} in ${before.provider}`);
if (!before.ok) {
  console.log('the reserves are already short; restore them in /admin before running this');
  process.exit(1);
}

let broken;
try {
  broken = await breakReserve(ctx, opts.brl);
} catch (error) {
  console.log(error instanceof AppError ? error.message : error);
  process.exit(1);
}
console.log(`minted    R$ ${broken.mintedBrl} with nothing behind it${link(broken.txHash)}`);
console.log(`now       R$ ${broken.supplyBrl} in tBRL against R$ ${broken.balanceBrl}, short by R$ ${broken.shortfallBrl}`);

const after = await monitorReserves(ctx, true);
if (!after) throw new Error('the monitor could not read the reserves');
console.log(`monitor   ${after.ok ? 'found nothing wrong' : `short by R$ ${after.shortfallBrl}`}, tBRL ${after.paused ? 'paused' : 'still running'}`);

if (!after.paused) {
  console.log('\nMISMATCH: the supply went past the balance and the token was not paused.');
  process.exitCode = 1;
} else if (opts.keep) {
  console.log('\nLeft broken and paused, as asked. Put it back in /admin, under Lastro.');
} else {
  const restored = await restoreReserve(ctx);
  console.log(`restored  R$ ${restored.burnedBrl} burned${link(restored.burnTx)}`);
  console.log(`          unpaused${link(restored.unpauseTx)}`);
  console.log(`after     R$ ${restored.supplyBrl} in tBRL against R$ ${restored.balanceBrl}`);
  const paused = await isPaused(ctx);
  const ok = restored.ok && !paused;
  console.log(ok ? '\nOK: broke it, the monitor paused it, and it is back.' : '\nMISMATCH: it did not come back; look at the lines above.');
  if (!ok) process.exitCode = 1;
}
await ctx.db.sql.end();
