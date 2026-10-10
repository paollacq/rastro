import { account, publicClient, rastroRfqAbi, rastroRfqBytecode, walletClient } from '@rastro/chain';
import { connect, FINAL_STATUSES, migrate, queries, type Sql, type Withdrawal } from '@rastro/db';
import { readFileSync } from 'node:fs';
import type { Abi, Address, Hex } from 'viem';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createContext, pixFromEnv, type Context } from './context.ts';
import { tick } from './orchestrator.ts';
import { createQuote, payQuote } from './quote.ts';
import { trace } from './trace.ts';
import { syncChain } from './watcher.ts';
import { requestWithdrawal } from './withdraw.ts';

// The whole Etapa 2 path against a real EVM and a real Postgres, with mocks standing in
// for the TIP-20 precompiles and the simulator standing in for Pix:
//   anvil --chain-id 42431 &
//   E2E_RPC_URL=http://127.0.0.1:8545 E2E_DATABASE_URL=postgres://... pnpm --filter @rastro/core test
// What only Tempo has (precompiles, policies, the batched transaction) is covered by
// chain:fill-test on Moderato.

const rpc = process.env.E2E_RPC_URL;
const dbUrl = process.env.E2E_DATABASE_URL;

// anvil's well-known development keys
const KEYS = {
  ADMIN: '0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80',
  TREASURY: '0x59c6995e998f97a5a0044966f0945389dc9e86dae88c7a8412f4603b6b78690d',
  QUOTER: '0x5de4111afa1a4b94908f83103eb1f1706367c2e68ca870fc3fb9a804cdab365a',
  PAYER: '0x7c852118294e51e653712a81e05800f419141751be58f605c371e15141b007a6',
  ANA: '0x47e179ec197488593b187f80a00eb0da91f1b9d0b13f8733639f19c30a34926a',
};

describe.skipIf(!rpc || !dbUrl)('invoice 0047, paid and withdrawn to Pix, on a local chain', () => {
  let ctx: Context;
  let sql: Sql;
  let tbrl: Address;
  let mockAbi: Abi;

  beforeAll(async () => {
    process.env.TEMPO_RPC_URL = rpc;
    for (const [role, key] of Object.entries(KEYS)) process.env[`${role}_PRIVATE_KEY`] = key;
    process.env.PTAX_OVERRIDE = '5.4123@2026-10-09';
    process.env.WATCH_FROM_BLOCK = '0';
    process.env.WATCH_LAG_BLOCKS = '0'; // anvil mines a block only when there is a transaction
    process.env.PIX_MODE = 'simulator';

    const mock = JSON.parse(
      readFileSync(new URL('../../../contracts/out/MockTIP20.sol/MockTIP20.json', import.meta.url), 'utf8'),
    );
    mockAbi = mock.abi;
    const client = publicClient();
    const admin = walletClient(account('admin'));
    const deploy = async (abi: Abi, bytecode: Hex, args: unknown[]) => {
      const hash = await admin.deployContract({ abi, bytecode, args });
      return (await client.waitForTransactionReceipt({ hash })).contractAddress as Address;
    };
    const send = async (address: Address, functionName: string, args: unknown[]) => {
      const hash = await admin.writeContract({ address, abi: mockAbi, functionName, args });
      await client.waitForTransactionReceipt({ hash });
    };

    const usd = await deploy(mockAbi, mock.bytecode.object, ['pathUSD (mock)', 'pathUSD']);
    tbrl = await deploy(mockAbi, mock.bytecode.object, ['Real Rastro (mock)', 'tBRL']);
    const treasury = account('treasury').address;
    const rfq = await deploy(rastroRfqAbi as Abi, rastroRfqBytecode, [account('admin').address, account('quoter').address, treasury, usd, tbrl]);
    for (const who of [treasury, rfq, account('ana').address]) await send(tbrl, 'setWhitelisted', [who, true]);
    await send(tbrl, 'setWhitelistOn', [true]);
    await send(usd, 'mint', [account('payer').address, 10_000_000_000n]);
    await send(tbrl, 'mint', [rfq, 10_000_000_000n]);

    sql = connect(dbUrl);
    await sql.unsafe('drop schema if exists public cascade; create schema public;');
    await migrate(sql);
    const db = queries(sql);
    await db.upsertUser({ id: 'ana', role: 'recebedora', name: 'Ana Ribeiro', wallet: account('ana').address, pixKey: 'ana.ribeiro@example.com', pixKeyType: 'email', pixKeyMasked: 'a•••@example.com', kycStatus: 'aprovado' });
    await db.upsertInvoice({ id: 'fatura-0047', number: '0047', payerName: 'Bramble & Pike Software, Inc.', payerWallet: account('payer').address, recipientId: 'ana', description: 'Backend, setembro: 28 h × US$ 55', amountUsd: '1540.00' });

    ctx = createContext({
      db,
      client,
      addresses: { tbrl, rfq, pathUsd: usd, treasury },
      pix: pixFromEnv(db),
      batchCalls: false,
      log: () => {},
    });
  }, 60_000);

  afterAll(async () => {
    await sql?.end();
  });

  const balanceOf = (who: Address) =>
    ctx.client.readContract({ address: tbrl, abi: mockAbi, functionName: 'balanceOf', args: [who] }) as Promise<bigint>;
  const supply = () => ctx.client.readContract({ address: tbrl, abi: mockAbi, functionName: 'totalSupply' }) as Promise<bigint>;

  async function untilFinal(id: string): Promise<Withdrawal> {
    for (let i = 0; i < 60; i++) {
      await syncChain(ctx);
      await tick(ctx);
      const w = await ctx.db.withdrawal(id);
      if (w && FINAL_STATUSES.includes(w.status)) {
        await syncChain(ctx); // the worker would pick up the burn or refund on its next pass
        return w;
      }
      await new Promise((resolve) => setTimeout(resolve, 200));
    }
    throw new Error(`${id} never finished`);
  }

  it('quotes at PTAX less the spread, rounded down to the centavo, and pays with the invoice as memo', async () => {
    const offer = await createQuote(ctx, 'fatura-0047');
    // 1,540.00 × 5.4123 × 0.995 = 8,293.267... -> R$ 8,293.26
    expect(offer.quote.brlOut).toBe('8293260000');
    expect(offer.ptax).toEqual({ rate: '5.4123', date: '2026-10-09', source: 'override' });

    await payQuote(ctx, offer.id);
    expect(await balanceOf(account('ana').address)).toBe(8_293_260_000n);
    await expect(payQuote(ctx, offer.id)).resolves.toMatchObject({ alreadyPaid: true });
    await expect(createQuote(ctx, 'fatura-0047')).rejects.toThrow('já foi paga');

    await syncChain(ctx);
    const trail = await trace(ctx, 'fatura-0047');
    const legs = trail?.payment.filter((event) => event.event === 'TransferWithMemo') ?? [];
    expect(legs).toHaveLength(2);
    expect(legs.every((leg) => leg.memoText === 'fatura-0047')).toBe(true);
  });

  it('withdraws to Pix and burns the tBRL with the Pix ID as memo', async () => {
    const before = await supply();
    const { id } = await requestWithdrawal(ctx, { userId: 'ana', amountBrl: '8000.00', invoiceId: 'fatura-0047' });
    const done = await untilFinal(id);
    expect(done.status).toBe('CONCLUIDO');

    const result = (await trace(ctx, id))?.withdrawals[0];
    expect(result?.steps.map((step) => step.status)).toEqual(['SOLICITADO', 'TBRL_NA_TESOURARIA', 'PIX_ENVIADO', 'PIX_CONFIRMADO', 'QUEIMADO', 'CONCLUIDO']);
    expect(result?.e2eId).toMatch(/^E99999999\d{12}SIM[A-Za-z0-9]{8}$/);
    expect(result?.e2eFormat).toBe('official');
    expect(result?.transfer[0]?.memoText).toBe(id);
    expect(result?.burn[0]?.memoText).toBe(result?.e2eId);
    expect(result?.burnMemoMatchesPix).toBe(true);
    expect(result?.pix[0]).toMatchObject({ provider: 'simulator', status: 'COMPLETED', e2eId: result?.e2eId });
    expect(await supply()).toBe(before - 8_000_000_000n);

    // Nothing happens twice: more ticks, no second burn.
    await syncChain(ctx);
    await tick(ctx);
    expect(await supply()).toBe(before - 8_000_000_000n);
  });

  it('gives the tBRL back when the Pix is refused (under R$ 10 in the simulator)', async () => {
    const ana = account('ana').address;
    const before = await balanceOf(ana);
    const { id } = await requestWithdrawal(ctx, { userId: 'ana', amountBrl: '5.00' });
    const done = await untilFinal(id);
    expect(done.status).toBe('DEVOLVIDO');
    expect(await balanceOf(ana)).toBe(before);
    const result = (await trace(ctx, id))?.withdrawals[0];
    expect(result?.refund[0]?.memoText).toBe(`devolucao ${id}`);
    expect(result?.steps.map((step) => step.status)).toEqual(['SOLICITADO', 'TBRL_NA_TESOURARIA', 'PIX_ENVIADO', 'FALHOU', 'DEVOLVIDO']);
  });

  it('burns once even with two orchestrators ticking at the same moment', async () => {
    const before = await supply();
    const { id } = await requestWithdrawal(ctx, { userId: 'ana', amountBrl: '50.00' });
    const rival = createContext({ ...ctx, instanceId: 'rival' } as Context);
    for (let i = 0; i < 40; i++) {
      await syncChain(ctx);
      await Promise.all([tick(ctx), tick(rival)]);
      const w = await ctx.db.withdrawal(id);
      if (w?.status === 'CONCLUIDO') break;
      await new Promise((resolve) => setTimeout(resolve, 200));
    }
    expect((await ctx.db.withdrawal(id))?.status).toBe('CONCLUIDO');
    expect(await supply()).toBe(before - 50_000_000n);
  });

  it('pays an invoice once, even when two quotes race for it', async () => {
    await ctx.db.upsertInvoice({ id: 'fatura-0048', number: '0048', payerName: 'Bramble & Pike Software, Inc.', payerWallet: account('payer').address, recipientId: 'ana', description: 'Teste de corrida', amountUsd: '10.00' });
    const [a, b] = await Promise.all([createQuote(ctx, 'fatura-0048'), createQuote(ctx, 'fatura-0048')]);
    const results = await Promise.allSettled([payQuote(ctx, a.id), payQuote(ctx, b.id)]);
    expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
    expect((await ctx.db.invoice('fatura-0048'))?.status).toBe('paga');
  });

  it('refuses a withdrawal larger than the balance before anything moves', async () => {
    await expect(requestWithdrawal(ctx, { userId: 'ana', amountBrl: '100000.00' })).rejects.toThrow('saldo insuficiente');
    await expect(requestWithdrawal(ctx, { userId: 'ana', amountBrl: '1.005' })).rejects.toThrow('valor inválido');
  });
});
