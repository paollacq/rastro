import { createContext, releaseOrchestrator, shortError, syncChain, tick } from '@rastro/core';

// Every 2 s: copy new chain events into Postgres, then move every open withdrawal as far
// as it can go. If a second worker starts, the lease in Postgres keeps it from moving
// anything until the first one stops.

const PASS_MS = 2_000;
const HEARTBEAT_MS = 60_000;

const ctx = createContext();

let running = true;
for (const signal of ['SIGINT', 'SIGTERM'] as const) {
  process.on(signal, () => {
    running = false;
  });
}

console.log(`worker ${ctx.instanceId} up · Pix via ${ctx.pix.name} · tBRL ${ctx.addresses.tbrl} · treasury ${ctx.addresses.treasury}`);

let lastBeat = 0;
while (running) {
  const started = Date.now();
  try {
    const events = await syncChain(ctx);
    const steps = await tick(ctx);
    if (events || steps) console.log(`${stamp()} +${events} chain events, ${steps} withdrawal steps`);
  } catch (error) {
    console.error(`${stamp()} pass failed: ${shortError(error)}`);
  }
  if (Date.now() - lastBeat > HEARTBEAT_MS) {
    lastBeat = Date.now();
    const open = await ctx.db.openWithdrawals().catch(() => []);
    const cursor = await ctx.db.state('chain_cursor').catch(() => null);
    console.log(`${stamp()} alive · block ${cursor ?? '?'} · ${open.length} open withdrawals`);
  }
  await new Promise((resolve) => setTimeout(resolve, Math.max(0, PASS_MS - (Date.now() - started))));
}

await releaseOrchestrator(ctx).catch(() => {});
await ctx.db.sql.end();

function stamp() {
  return new Date().toISOString().slice(11, 19);
}
