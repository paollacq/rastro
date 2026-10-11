import { account, rastroRfqAbi, textMemo, tip403Registry } from '@rastro/chain';
import type { Queries } from '@rastro/db';
import { toCents } from '@rastro/pix';
import type { Address } from 'viem';
import { Abis } from 'viem/tempo';
import type { Context } from './context.ts';
import { AppError, shortError } from './errors.ts';
import { BASE_PER_CENT, baseToBrl, brlToBase, floorToCents } from './money.ts';
import { burnMemo } from './orchestrator.ts';
import { activePix, clearCredentialFlag, isCredentialError } from './pix-mode.ts';
import { isPaused, setPaused } from './reserves.ts';
import { writeAndWait } from './tx.ts';

// `pnpm demo:reset`: the demo back to its first frame, in under two minutes, before every
// recording. The hard part is not the database, it is the chain: tBRL from earlier runs is
// spread over Ana, the treasury and the RFQ, and a new sandbox credential comes with a new
// balance. So the reset pulls every token it can reach back to the treasury, burns them,
// and mints exactly the stock the reais behind it allow.

const MEMO = 'rastro:reset';

export interface ResetReport {
  balanceBrl: string;
  toppedUpBrl: string;
  supplyBefore: string;
  supplyAfter: string;
  inventoryBrl: string;
  strandedBrl: string;
  txs: { what: string; hash: string }[];
  cleared: Record<string, number>;
  unpaused: boolean;
  seconds: number;
}

export async function resetDemo(ctx: Context, options: { inventoryBrl?: string } = {}): Promise<ResetReport> {
  const started = Date.now();
  const txs: { what: string; hash: string }[] = [];
  const { tbrl, rfq } = ctx.addresses;
  const treasury = ctx.signer('treasury').account.address;
  const ana = ctx.signer('ana').account.address;

  // 1. The Pix side first: without a working credential there is nothing to back a demo.
  const pix = await activePix(ctx);
  let balanceBrl: string;
  try {
    balanceBrl = (await pix.balance()).availableBrl;
  } catch (error) {
    if (isCredentialError(error)) {
      throw new AppError(
        503,
        'a credencial do sandbox não responde mais. Gere outra em https://docs.payzu.com.br/docs/pix-processamento/sandbox/credencial, ponha em PAYZU_TOKEN e rode pnpm pix:credencial',
        'credential_expired',
      );
    }
    throw new AppError(502, `não deu para ler o saldo do Pix: ${shortError(error)}`, 'pix_unreachable');
  }

  // 1b. Every run spends part of the Pix balance and never gets it back, so the account is
  // topped up to the stock the demo needs. In the sandbox a charge is paid by a simulated
  // payer and lands in about ten seconds.
  const target = floorToCents(brlToBase(options.inventoryBrl ?? process.env.RFQ_INVENTORY_BRL ?? '10000'));
  let toppedUp = 0n;
  const missing = target - toCents(balanceBrl) * BASE_PER_CENT;
  if (missing > 0n) {
    const amountBrl = baseToBrl(floorToCents(missing));
    try {
      await pix.createCharge({ amountBrl, reference: `reset-${Date.now()}` });
      const deadline = Date.now() + 45_000;
      while (Date.now() < deadline) {
        const now = (await pix.balance()).availableBrl;
        if (toCents(now) * BASE_PER_CENT >= target) {
          toppedUp = missing;
          balanceBrl = now;
          break;
        }
        await new Promise((resolve) => setTimeout(resolve, 2_000));
      }
      if (toppedUp === 0n) ctx.log(`a recarga de R$ ${amountBrl} não caiu a tempo; seguindo com R$ ${balanceBrl}`);
    } catch (error) {
      ctx.log(`não deu para recarregar o Pix (R$ ${amountBrl}): ${shortError(error)}`);
    }
  }

  // 2. Nothing moves while the token is paused, so a reset starts by lifting it.
  const wasPaused = await isPaused(ctx);
  if (wasPaused) {
    const hash = await setPaused(ctx, false);
    if (hash) txs.push({ what: 'despausa', hash });
  }

  // 3. Pull the tBRL back. What other wallets hold stays where it is: we have no key for
  // them, and it is their money. It counts against the stock we may mint.
  const read = (functionName: 'totalSupply' | 'balanceOf', args: readonly unknown[] = []) =>
    ctx.client.readContract({ address: tbrl, abi: Abis.tip20, functionName, args } as never) as Promise<bigint>;

  const [supplyBefore, anaHolds, rfqHolds, treasuryHolds] = await Promise.all([
    read('totalSupply'),
    read('balanceOf', [ana]),
    read('balanceOf', [rfq]),
    read('balanceOf', [treasury]),
  ]);

  // tBRL in wallets we hold no key for stays where it is, and takes up room in the stock.
  const stranded = supplyBefore - anaHolds - rfqHolds - treasuryHolds;
  const backing = toCents(balanceBrl) * BASE_PER_CENT;
  const wanted = target;
  const room = backing > stranded ? backing - stranded : 0n;
  const inventory = floorToCents(wanted < room ? wanted : room);

  // Already in its first frame: no need to burn and mint the same amount again.
  const settled = anaHolds === 0n && treasuryHolds === 0n && rfqHolds === inventory;

  if (anaHolds > 0n && !settled) {
    txs.push({
      what: `${baseToBrl(floorToCents(anaHolds))} da Ana para a tesouraria`,
      hash: await writeAndWait(
        ctx,
        'ana',
        { address: tbrl, abi: Abis.tip20, functionName: 'transferWithMemo', args: [treasury, anaHolds, textMemo(MEMO)] },
        'a devolução do tBRL da Ana',
      ),
    });
  }

  if (rfqHolds > 0n && !settled) {
    txs.push({
      what: `${baseToBrl(floorToCents(rfqHolds))} do RFQ para a tesouraria`,
      hash: await writeAndWait(
        ctx,
        'admin',
        { address: rfq, abi: rastroRfqAbi, functionName: 'sweep', args: [rfqHolds] },
        'o sweep do RFQ',
      ),
    });
  }

  const held = settled ? 0n : await read('balanceOf', [treasury]);
  if (held > 0n) {
    txs.push({
      what: `${baseToBrl(floorToCents(held))} queimados`,
      hash: await writeAndWait(
        ctx,
        'treasury',
        { address: tbrl, abi: Abis.tip20, functionName: 'burnWithMemo', args: [held, burnMemo(MEMO)] },
        'a queima do estoque',
      ),
    });
  }

  // 4. Mint the stock again, up to what the reais behind it allow.
  if (inventory > 0n && !settled) {
    txs.push({
      what: `${baseToBrl(inventory)} emitidos para o RFQ`,
      hash: await writeAndWait(
        ctx,
        'treasury',
        { address: tbrl, abi: Abis.tip20, functionName: 'mintWithMemo', args: [rfq, inventory, textMemo('rastro:inventory')] },
        'a emissão do estoque',
      ),
    });
  }

  // 5. The database: everything the demo wrote, and then its first frame again.
  const cleared = await ctx.db.clearDemo();
  await seedCast(ctx.db);
  await clearCredentialFlag(ctx);

  return {
    balanceBrl,
    toppedUpBrl: baseToBrl(toppedUp),
    supplyBefore: baseToBrl(floorToCents(supplyBefore)),
    supplyAfter: baseToBrl(floorToCents(await read('totalSupply'))),
    inventoryBrl: baseToBrl(inventory),
    strandedBrl: baseToBrl(floorToCents(stranded)),
    txs,
    cleared,
    unpaused: wasPaused,
    seconds: Math.round((Date.now() - started) / 100) / 10,
  };
}

// Ana, the payer and invoice #0047, exactly as the spec's cast. Safe to run again.
export async function seedCast(db: Queries) {
  const ana = account('ana');
  const payer = account('payer');

  await db.upsertUser({
    id: 'ana',
    role: 'recebedora',
    name: 'Ana Ribeiro',
    wallet: ana.address,
    // A test key on a reserved domain: it can never belong to a real person.
    pixKey: 'ana.ribeiro@example.com',
    pixKeyType: 'email',
    pixKeyMasked: 'a•••@example.com',
    kycStatus: 'aprovado',
    city: 'Recife',
  });
  await db.upsertUser({
    id: 'bramble-pike',
    role: 'pagador',
    name: 'Bramble & Pike Software, Inc.',
    wallet: payer.address,
    city: 'Austin, Texas',
  });
  await db.upsertInvoice({
    id: 'fatura-0047',
    number: '0047',
    payerName: 'Bramble & Pike Software, Inc.',
    payerWallet: payer.address,
    recipientId: 'ana',
    description: 'Backend, setembro: 28 h × US$ 55',
    items: [{ description: 'Backend work, September', hours: 28, rateUsd: '55.00' }],
    amountUsd: '1540.00',
  });
}

// Who is missing from the TIP-403 policy. The reset only reports it: putting a wallet on a
// policy is a deliberate act, and on Moderato it already happened at setup.
export async function policyGaps(ctx: Context): Promise<string[]> {
  const { policyId } = ctx.addresses;
  if (policyId === undefined) return [];
  const wallets: [string, Address][] = [
    ['tesouraria', ctx.signer('treasury').account.address],
    ['RFQ', ctx.addresses.rfq],
    ['Ana', ctx.signer('ana').account.address],
  ];
  const missing: string[] = [];
  for (const [who, wallet] of wallets) {
    const ok = await ctx.client.readContract({
      address: tip403Registry,
      abi: Abis.tip403Registry,
      functionName: 'isAuthorized',
      args: [policyId, wallet],
    });
    if (!ok) missing.push(`${who} (${wallet})`);
  }
  return missing;
}
