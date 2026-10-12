// The demo back to its first frame, before a recording or a rehearsal.
//
//   pnpm demo:reset                    stock up to RFQ_INVENTORY_BRL, never past the Pix balance
//   pnpm demo:reset --inventory 500    a smaller stock, for a quick run
//
// It pulls the tBRL back from Ana and the RFQ, burns it, mints the stock again, clears what
// the demo wrote and recreates Ana, the payer and invoice #0047.
import { explorer } from '@rastro/chain';
import { parseArgs } from 'node:util';
import { createContext } from '../context.ts';
import { policyGaps, resetDemo } from '../demo.ts';
import { AppError } from '../errors.ts';

const { values: opts } = parseArgs({ options: { inventory: { type: 'string' } } });
const ctx = createContext();

let report;
try {
  report = await resetDemo(ctx, { inventoryBrl: opts.inventory });
} catch (error) {
  console.log(error instanceof AppError ? error.message : error);
  await ctx.db.sql.end();
  process.exit(1);
}

console.log(`Pix          R$ ${report.balanceBrl} em ${ctx.pix.name}${report.toppedUpBrl !== '0.00' ? ` (recarregados R$ ${report.toppedUpBrl})` : ''}`);
console.log(`tBRL         R$ ${report.supplyBefore} -> R$ ${report.supplyAfter}`);
if (report.strandedBrl !== '0.00') console.log(`             R$ ${report.strandedBrl} em carteiras de clientes, fora do estoque`);
console.log(`estoque      R$ ${report.inventoryBrl} no RFQ\n`);

if (report.unpaused) console.log('tBRL estava pausado e foi despausado.');
for (const tx of report.txs) console.log(`  ${tx.what.padEnd(42)} ${explorer}/tx/${tx.hash}`);

const cleared = Object.entries(report.cleared).filter(([, n]) => n > 0);
console.log(
  cleared.length ? `\ncleared ${cleared.map(([table, n]) => `${n} ${table}`).join(', ')}` : '\nnothing to clear',
);
console.log('fatura-0047 aberta, Ana e Bramble & Pike no lugar.');

const gaps = await policyGaps(ctx);
if (gaps.length) console.log(`\nWARNING: not on TIP-403 policy: ${gaps.join(', ')}. Run pnpm chain:setup.`);

console.log(`\npronto em ${report.seconds}s`);
await ctx.db.sql.end();
