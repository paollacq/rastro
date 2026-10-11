import { effectivePixMode, isPaused, readReserves, shortError } from '@rastro/core';
import { context } from '../../../lib/api';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

// What the deploy's health check reads, and the first thing to open when something looks
// wrong: the database, the Tempo node and the Pix provider, each with its own answer.
// 200 when everything replies, 503 when any of them does not.
export async function GET() {
  const ctx = context();
  const checks: Record<string, { ok: boolean; detail: string }> = {};

  const check = async (name: string, work: () => Promise<string>) => {
    const started = Date.now();
    try {
      checks[name] = { ok: true, detail: `${await work()} (${Date.now() - started}ms)` };
    } catch (error) {
      checks[name] = { ok: false, detail: shortError(error) };
    }
  };

  await check('database', async () => {
    const [row] = await ctx.db.sql<{ now: Date }[]>`select now()`;
    return row.now.toISOString();
  });
  await check('tempo', async () => `bloco ${await ctx.client.getBlockNumber({ cacheTime: 0 })}`);
  await check('pix', async () => {
    const mode = await effectivePixMode(ctx);
    const reserves = await readReserves(ctx);
    return `${mode}, R$ ${reserves.balanceBrl} de lastro${reserves.ok ? '' : `, faltando R$ ${reserves.shortfallBrl}`}`;
  });
  await check('tbrl', async () => ((await isPaused(ctx)) ? 'pausado' : 'funcionando'));

  const ok = Object.values(checks).every((check) => check.ok);
  return Response.json({ ok, checks, at: new Date().toISOString() }, { status: ok ? 200 : 503 });
}
