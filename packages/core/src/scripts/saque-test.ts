// The Etapa 2 finish line: a withdrawal that ends with the same Pix ID in the webhook (or
// the provider's answer) and in the memo of the burn. Start the worker first, in another
// terminal: pnpm worker
//
//   pnpm saque:test               R$ 150.00 (or all of Ana's tBRL if she has less), which
//                                 the sandbox holds as pending for ~10 s above R$ 100
//   pnpm saque:test --brl 50      settles at once
//   pnpm saque:test --brl 5       refused by the sandbox: shows the refund path
//   pnpm saque:test --inline      runs the watcher and the state machine itself (stop the worker)
import { explorer } from '@rastro/chain';
import { FINAL_STATUSES } from '@rastro/db';
import { endToEndFormat } from '@rastro/pix';
import { parseArgs } from 'node:util';
import type { Hex } from 'viem';
import { Abis } from 'viem/tempo';
import { createContext } from '../context.ts';
import { AppError } from '../errors.ts';
import { baseToBrl, brlToBase, floorToCents } from '../money.ts';
import { releaseOrchestrator, tick } from '../orchestrator.ts';
import { trace } from '../trace.ts';
import { syncChain } from '../watcher.ts';
import { requestWithdrawal } from '../withdraw.ts';

const { values: opts } = parseArgs({
  options: {
    brl: { type: 'string', default: '150.00' },
    user: { type: 'string', default: 'ana' },
    inline: { type: 'boolean', default: false },
  },
});

const ctx = createContext();

// Ask for what was requested, or for everything Ana has if that is less.
const user = await ctx.db.user(opts.user);
if (!user) throw new Error(`no user "${opts.user}"; run pnpm db:seed`);
const balance = await ctx.client.readContract({ address: ctx.addresses.tbrl, abi: Abis.tip20, functionName: 'balanceOf', args: [user.wallet as Hex] });
const wanted = brlToBase(opts.brl);
const amount = floorToCents(balance < wanted ? balance : wanted);
if (amount === 0n) {
  console.log(`${user.name} holds R$ ${baseToBrl(floorToCents(balance))} in tBRL. Pay something first: pnpm chain:fill-test`);
  process.exit(1);
}
const amountBrl = baseToBrl(amount);

let request: { id: string; transferTx: string };
try {
  request = await requestWithdrawal(ctx, { userId: opts.user, amountBrl });
} catch (error) {
  console.log(error instanceof AppError ? error.message : error);
  process.exit(1);
}
const { id, transferTx } = request;
console.log(`${id}  R$ ${amountBrl} via ${ctx.pix.name}\ntransfer  ${explorer}/tx/${transferTx}\n`);

const printed = new Set<string>();
const started = Date.now();
let warned = false;
for (;;) {
  if (opts.inline) {
    await syncChain(ctx);
    await tick(ctx);
  }
  for (const step of await ctx.db.steps(id)) {
    const key = `${step.status}@${step.at.getTime()}`;
    if (printed.has(key)) continue;
    printed.add(key);
    console.log(`${step.at.toISOString().slice(11, 19)}  ${step.status.padEnd(19)} ${step.detail ?? ''}`);
  }
  const current = await ctx.db.withdrawal(id);
  if (!current) throw new Error(`${id} disappeared`);
  if (FINAL_STATUSES.includes(current.status)) break;
  if (!warned && current.status === 'SOLICITADO' && Date.now() - started > 15_000) {
    console.log('...nothing moved in 15 s. Is the worker running? (pnpm worker, or rerun with --inline)');
    warned = true;
  }
  if (Date.now() - started > 120_000) {
    console.log(`still ${current.status} after 2 minutes`);
    process.exit(1);
  }
  await new Promise((resolve) => setTimeout(resolve, 1_000));
}

// The burn or refund lands in chain_events on the watcher's next pass.
let result = (await trace(ctx, id))?.withdrawals[0];
for (let i = 0; i < 15 && result && !(result.burn.length || result.refund.length || result.status === 'CANCELADO'); i++) {
  if (opts.inline) await syncChain(ctx);
  else await new Promise((resolve) => setTimeout(resolve, 1_000));
  result = (await trace(ctx, id))?.withdrawals[0];
}
if (!result) throw new Error('no trace');
console.log('');

if (result.status === 'CONCLUIDO') {
  const pixId = result.e2eId ?? '';
  const burnMemo = result.burn[0]?.memoText ?? null;
  const webhook = result.pix.find((event) => event.provider === 'payzu-sandbox' && event.e2eId);
  const format = endToEndFormat(pixId);
  const same = (value: string | null | undefined) => (value === pixId ? 'same' : 'DIFFERENT');

  console.log(`Pix ID     ${pixId}  (${format ?? 'unknown'} format, ${pixId.length} characters)`);
  console.log(`burn memo  ${burnMemo ?? '(not seen yet)'}  ${burnMemo ? same(burnMemo) : ''}`);
  if (webhook) {
    console.log(`webhook    ${webhook.e2eId}  ${same(webhook.e2eId)}, signature checked`);
  } else if (ctx.pix.name === 'payzu-sandbox') {
    console.log('webhook    none received; register it with pnpm pix:webhook <public url>');
  } else {
    console.log('webhook    simulator: the event is written by the simulator itself');
  }
  console.log(`burn tx    ${explorer}/tx/${result.burn[0]?.txHash ?? ''}`);
  const ok = burnMemo === pixId && (!webhook || webhook.e2eId === pixId);
  console.log(ok ? '\nOK: one Pix ID, the same in every place.' : '\nMISMATCH: look at the lines above.');
  if (!ok) process.exitCode = 1;
} else {
  console.log(`${result.status}: ${result.failure ?? ''}`);
  if (result.refund[0]) console.log(`refund     ${explorer}/tx/${result.refund[0].txHash}  memo "${result.refund[0].memoText}"`);
}
// Hand the lease back, or the next run sits idle until it lapses (120 s).
await releaseOrchestrator(ctx).catch(() => {});
await ctx.db.sql.end();
