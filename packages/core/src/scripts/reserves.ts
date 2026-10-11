// One round of the reserve monitor, the same one the worker runs every 15 s.
//
//   pnpm lastro
import { createContext } from '../context.ts';
import { monitorReserves } from '../reserves.ts';

const ctx = createContext();
const reading = await monitorReserves(ctx, true);
if (!reading) {
  console.log('could not read the reserves; see the message above');
  process.exitCode = 1;
} else {
  console.log(`tBRL in circulation  R$ ${reading.supplyBrl}`);
  console.log(`reais at ${reading.provider.padEnd(13)} R$ ${reading.balanceBrl}`);
  console.log(
    reading.ok
      ? '\nOK: every tBRL has a real behind it.'
      : `\nSHORT by R$ ${reading.shortfallBrl}. tBRL ${reading.pausedNow ? 'was just paused' : 'is paused'} on-chain.`,
  );
}
await ctx.db.sql.end();
