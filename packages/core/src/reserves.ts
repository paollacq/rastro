import { toCents } from '@rastro/pix';
import { Abis } from 'viem/tempo';
import type { Context } from './context.ts';
import { AppError, shortError } from './errors.ts';
import { BASE_PER_CENT, baseToBrl, brlToBase, floorToCents } from './money.ts';
import { burnMemo } from './orchestrator.ts';
import { activePix, isCredentialError, markCredentialExpired } from './pix-mode.ts';
import { writeAndWait } from './tx.ts';

// The invariant: tBRL in circulation never goes over the reais behind it. The worker reads
// both every 15 seconds, writes the reading down, and if the supply ever goes past the
// backing it pauses the token on-chain. Nothing moves while it is paused, and a human
// decides when it comes back.
//
// "Behind it" is the Pix account plus whatever is in flight: from the moment a Pix leaves
// until the tBRL is burned, the balance has already dropped and the supply has not. That
// window is a few seconds of every withdrawal, and counting it is what keeps the monitor
// from pausing the token in the middle of one, which would leave the burn unable to run.

const EVERY_MS = 15_000;
const LAST_RUN = 'reserve_checked_at';
const MEMO_RESTORE = 'rastro:restore';
const MEMO_DEMO = 'rastro:demo';

export interface ReserveReading {
  supplyBrl: string; // tBRL in circulation, as reais
  balanceBrl: string; // what the Pix account holds
  inFlightBrl: string; // sent by Pix, tBRL not burned yet
  ok: boolean;
  shortfallBrl: string; // tBRL with nothing behind it; "0.00" when the invariant holds
  paused: boolean;
  pausedNow: boolean; // this reading is the one that paused it
  provider: string;
}

export async function readReserves(ctx: Context) {
  const [supply, balance, inFlight] = await Promise.all([
    ctx.client.readContract({ address: ctx.addresses.tbrl, abi: Abis.tip20, functionName: 'totalSupply' }),
    (await activePix(ctx)).balance(),
    ctx.db.inFlightBrl(),
  ]);
  const backed = toCents(balance.availableBrl) * BASE_PER_CENT + inFlight;
  const missing = supply > backed ? supply - backed : 0n;
  return {
    supply,
    backed,
    inFlight,
    balanceBrl: balance.availableBrl,
    ok: missing === 0n,
    // Rounded up: a fraction of a centavo without backing still breaks the invariant.
    shortfallBrl: baseToBrl(missing + ((BASE_PER_CENT - (missing % BASE_PER_CENT)) % BASE_PER_CENT)),
  };
}

// One round of the monitor. Returns null when it is not due yet.
export async function monitorReserves(ctx: Context, force = false): Promise<ReserveReading | null> {
  if (!force) {
    const last = await ctx.db.state(LAST_RUN);
    if (last && ctx.now().getTime() - Number(last) < EVERY_MS) return null;
  }
  await ctx.db.setState(LAST_RUN, String(ctx.now().getTime()));

  let reading;
  try {
    reading = await readReserves(ctx);
  } catch (error) {
    // A credential that stopped working is the sandbox telling us to use the simulator.
    if (isCredentialError(error)) await markCredentialExpired(ctx, shortError(error));
    else ctx.log(`reserve check failed: ${shortError(error)}`);
    return null;
  }

  await ctx.db.insertReserveCheck({
    supply: reading.supply.toString(),
    balanceBrl: reading.balanceBrl,
    ok: reading.ok,
  });

  const provider = (await activePix(ctx)).name;
  let paused = await isPaused(ctx);
  let pausedNow = false;
  if (!reading.ok && !paused) {
    await setPaused(ctx, true);
    paused = true;
    pausedNow = true;
    ctx.log(
      `reserves broken: R$ ${baseToBrl(floorToCents(reading.supply))} in tBRL against R$ ${reading.balanceBrl} in ${provider}` +
        `${reading.inFlight > 0n ? ` plus R$ ${baseToBrl(floorToCents(reading.inFlight))} on its way out` : ''}. tBRL paused.`,
    );
  }

  return {
    supplyBrl: baseToBrl(floorToCents(reading.supply)),
    balanceBrl: reading.balanceBrl,
    inFlightBrl: baseToBrl(floorToCents(reading.inFlight)),
    ok: reading.ok,
    shortfallBrl: reading.shortfallBrl,
    paused,
    pausedNow,
    provider,
  };
}

export async function isPaused(ctx: Context): Promise<boolean> {
  return ctx.client.readContract({ address: ctx.addresses.tbrl, abi: Abis.tip20, functionName: 'paused' });
}

// Pausing and unpausing are the admin's; the treasury only mints and burns.
export async function setPaused(ctx: Context, paused: boolean): Promise<string | null> {
  if ((await isPaused(ctx)) === paused) return null;
  return writeAndWait(
    ctx,
    'admin',
    { address: ctx.addresses.tbrl, abi: Abis.tip20, functionName: paused ? 'pause' : 'unpause', args: [] },
    paused ? 'a pausa' : 'a despausa',
  );
}

// --- the demo's two buttons ---------------------------------------------------------------

// Mints tBRL that no real has behind it, so the next monitor round finds the invariant
// broken and pauses the token. Only for the technical demo.
export async function breakReserve(ctx: Context, amountBrl = '1000.00') {
  let amount: bigint;
  try {
    amount = floorToCents(brlToBase(amountBrl));
  } catch {
    throw new AppError(400, 'valor inválido: use reais com até dois centavos, como 1000.00', 'invalid_amount');
  }
  if (amount <= 0n) throw new AppError(400, 'o valor precisa ser maior que zero', 'invalid_amount');
  if (await isPaused(ctx)) {
    throw new AppError(409, 'o tBRL já está pausado; restaure as reservas antes', 'already_paused');
  }

  const { account } = ctx.signer('treasury');
  // The memo says out loud what this is, so the mint is recognizable in the trail.
  const txHash = await writeAndWait(
    ctx,
    'treasury',
    {
      address: ctx.addresses.tbrl,
      abi: Abis.tip20,
      functionName: 'mintWithMemo',
      args: [account.address, amount, burnMemo(MEMO_DEMO)],
    },
    'a emissão',
  );
  const reading = await readReserves(ctx);
  return {
    mintedBrl: baseToBrl(amount),
    txHash,
    supplyBrl: baseToBrl(floorToCents(reading.supply)),
    balanceBrl: reading.balanceBrl,
    shortfallBrl: reading.shortfallBrl,
  };
}

// Puts it back: unpause, then burn whatever the treasury holds beyond the reais behind it.
export async function restoreReserve(ctx: Context) {
  const unpauseTx = await setPaused(ctx, false);
  const reading = await readReserves(ctx);
  const excess = reading.supply > reading.backed ? reading.supply - reading.backed : 0n;
  const held = await ctx.client.readContract({
    address: ctx.addresses.tbrl,
    abi: Abis.tip20,
    functionName: 'balanceOf',
    args: [ctx.signer('treasury').account.address],
  });
  const burn = floorToCents(excess < held ? excess : held);

  let burnTx: string | null = null;
  if (burn > 0n) {
    burnTx = await writeAndWait(
      ctx,
      'treasury',
      { address: ctx.addresses.tbrl, abi: Abis.tip20, functionName: 'burnWithMemo', args: [burn, burnMemo(MEMO_RESTORE)] },
      'a queima',
    );
  }

  const after = await readReserves(ctx);
  return {
    unpauseTx,
    burnTx,
    burnedBrl: baseToBrl(burn),
    supplyBrl: baseToBrl(floorToCents(after.supply)),
    balanceBrl: after.balanceBrl,
    shortfallBrl: after.shortfallBrl,
    ok: after.ok,
  };
}

