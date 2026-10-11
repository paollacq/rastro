import { account, publicClient, rastroRfqAbi, rastroRfqBytecode, tip403Registry, walletClient } from '@rastro/chain';
import { assertThrowawayDatabase, connect, FINAL_STATUSES, migrate, queries, type Sql, type Withdrawal } from '@rastro/db';
import { readFileSync } from 'node:fs';
import type { Abi, Address, Hex } from 'viem';
import { Abis } from 'viem/tempo';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { autoWithdraw } from './auto-withdraw.ts';
import { createContext, pixFromEnv, type Context } from './context.ts';
import { resetDemo } from './demo.ts';
import { registerClient } from './kyc.ts';
import { tick } from './orchestrator.ts';
import { testTransfer } from './policy.ts';
import { createQuote, payQuote } from './quote.ts';
import { checkReport, reconcileReport } from './reconcile.ts';
import { breakReserve, isPaused, monitorReserves, restoreReserve } from './reserves.ts';
import { trace } from './trace.ts';
import { allowlistView, operationsView, reservesView, walletView } from './views.ts';
import { syncChain } from './watcher.ts';
import { requestWithdrawal } from './withdraw.ts';

// The whole Etapa 2 path against a real EVM and a real Postgres, with mocks standing in
// for the TIP-20 precompiles and the simulator standing in for Pix:
//   anvil --chain-id 42431 &
//   E2E_RPC_URL=http://127.0.0.1:8545 E2E_DATABASE_URL=postgres://... pnpm --filter @rastro/core test
// Both the chain and the database are wiped at the start, so E2E_DATABASE_URL has to be a
// throwaway one (assertThrowawayDatabase refuses anything else).
// What only Tempo has (precompiles, policies, the batched transaction) is covered by
// chain:fill-test on Moderato. The TIP-403 registry gets a mock at its own address, so the
// whitelist the screens show comes from real events.

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

    const artifact = (name: string) =>
      JSON.parse(readFileSync(new URL(`../../../contracts/out/${name}.sol/${name}.json`, import.meta.url), 'utf8'));
    const mock = artifact('MockTIP20');
    const registry = artifact('MockTIP403Registry');
    mockAbi = mock.abi;
    const client = publicClient();
    // A fresh chain every run: anvil_setCode replaces code but keeps whatever storage was
    // at that address, so the registry mock would remember the last run's whitelist.
    await client.request({ method: 'anvil_reset' as never, params: [] as never });
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
    // The registry, at the same address and with the same event as on Tempo, and a tBRL
    // that asks it before every move, like a real TIP-20 asks TIP-403.
    await client.request({ method: 'anvil_setCode' as never, params: [tip403Registry, registry.deployedBytecode.object] as never });
    for (const who of [treasury, rfq, account('ana').address]) {
      const hash = await admin.writeContract({ address: tip403Registry, abi: registry.abi, functionName: 'modifyPolicyWhitelist', args: [7n, who, true] });
      await client.waitForTransactionReceipt({ hash });
    }
    await send(tbrl, 'setPolicy', [tip403Registry, 7n]);
    await send(usd, 'mint', [account('payer').address, 10_000_000_000n]);
    await send(tbrl, 'mint', [rfq, 10_000_000_000n]);

    sql = connect(assertThrowawayDatabase(dbUrl, 'o teste de ponta a ponta'));
    await sql.unsafe('drop schema if exists public cascade; create schema public;');
    await migrate(sql);
    const db = queries(sql);
    await db.upsertUser({ id: 'ana', role: 'recebedora', name: 'Ana Ribeiro', wallet: account('ana').address, pixKey: 'ana.ribeiro@example.com', pixKeyType: 'email', pixKeyMasked: 'a•••@example.com', kycStatus: 'aprovado' });
    await db.upsertInvoice({ id: 'fatura-0047', number: '0047', payerName: 'Bramble & Pike Software, Inc.', payerWallet: account('payer').address, recipientId: 'ana', description: 'Backend, setembro: 28 h × US$ 55', amountUsd: '1540.00' });

    ctx = createContext({
      db,
      client,
      addresses: { tbrl, rfq, pathUsd: usd, treasury, policyId: 7n },
      pix: pixFromEnv(db),
      batchCalls: false,
      log: () => {},
    });
  }, 60_000);

  afterAll(async () => {
    await sql?.end();
  });

  const identified = (wallet: string) =>
    ctx.client.readContract({ address: tip403Registry, abi: Abis.tip403Registry, functionName: 'isAuthorized', args: [7n, wallet as Address] });

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

  it('refuses a second withdrawal of an invoice that already went out', async () => {
    await expect(requestWithdrawal(ctx, { userId: 'ana', amountBrl: '10.00', invoiceId: 'fatura-0047' })).rejects.toThrow(
      'já tem um saque',
    );
  });

  it('withdraws by itself what arrives after Ana turns it on, once', async () => {
    await ctx.db.setAutoWithdraw('ana', true);
    expect(await autoWithdraw(ctx)).toBe(0); // 0047 and 0048 were paid before
    await ctx.db.upsertInvoice({ id: 'fatura-0049', number: '0049', payerName: 'Bramble & Pike Software, Inc.', payerWallet: account('payer').address, recipientId: 'ana', description: 'Revisão de código', amountUsd: '10.00' });
    await payQuote(ctx, (await createQuote(ctx, 'fatura-0049')).id);
    expect(await autoWithdraw(ctx)).toBe(1);
    expect(await autoWithdraw(ctx)).toBe(0);
    const [w] = await ctx.db.withdrawalsForInvoice('fatura-0049');
    // 10.00 × 5.4123 × 0.995 = 53.852... -> R$ 53.85, all of it
    expect(w.amountBrl).toBe('53850000');
    expect((await untilFinal(w.id)).status).toBe('CONCLUIDO');
  });

  it('puts a new client on the policy, keeping only the hash of the CPF', async () => {
    const wallet = '0x00000000000000000000000000000000000c1e27';
    expect(await identified(wallet)).toBe(false);

    const done = await registerClient(ctx, {
      name: 'Marina Souza Lima',
      cpf: '529.982.247-25',
      pixKey: '+55 81 99999-8888',
      wallet,
      city: 'Olinda',
    });
    expect(done).toMatchObject({ cpfMasked: '•••.982.247-••', pixKeyMasked: '+55 81 •••••-8888', policyId: '7', alreadyOnPolicy: false });
    expect(await identified(wallet)).toBe(true);

    const saved = await ctx.db.user(done.id);
    expect(saved?.pixKeyType).toBe('phone');
    expect(saved?.cpfHash).toMatch(/^[0-9a-f]{64}$/);
    expect(JSON.stringify(saved)).not.toContain('52998224725');
    expect((await ctx.db.policyChanges())[0]).toMatchObject({ allowed: true, actor: `cadastro ${done.id}` });

    // The same person again is an update, not a second client or a second transaction.
    const again = await registerClient(ctx, { name: 'Marina Souza Lima', cpf: '52998224725', pixKey: 'marina@example.com', wallet });
    expect(again).toMatchObject({ id: done.id, alreadyOnPolicy: true, txHash: null });
    await expect(
      registerClient(ctx, { name: 'Outra Pessoa', cpf: '529.982.247-25', pixKey: 'outra@example.com', wallet: '0x00000000000000000000000000000000000c1e28' }),
    ).rejects.toThrow('já tem cadastro');
    await expect(registerClient(ctx, { name: 'Marina', cpf: '529.982.247-25', pixKey: 'a@b.co', wallet })).rejects.toThrow('nome completo');
    await expect(registerClient(ctx, { name: 'Marina Lima', cpf: '529.982.247-24', pixKey: 'a@b.co', wallet })).rejects.toThrow('dígito verificador');
  });

  it('lets the protocol refuse a transfer to a wallet outside the policy, and writes it down', async () => {
    // Ana needs a little tBRL of her own to try to send.
    await ctx.db.upsertInvoice({ id: 'fatura-0050', number: '0050', payerName: 'Bramble & Pike Software, Inc.', payerWallet: account('payer').address, recipientId: 'ana', description: 'Ajuste de rota', amountUsd: '5.00' });
    await payQuote(ctx, (await createQuote(ctx, 'fatura-0050')).id);

    const stranger = '0x9f00000000000000000000000000000000000c02';
    const refused = await testTransfer(ctx, { wallet: stranger, amountBrl: '1.00' });
    expect(refused).toMatchObject({ allowed: false, identified: false, txHash: null });
    expect(refused.reason).toContain('not on policy 7');
    expect(refused.reason).toContain('PolicyForbids');
    expect(await balanceOf(stranger as Address)).toBe(0n);

    const [recorded] = await ctx.db.blockedAttempts();
    expect(recorded).toMatchObject({ toAddress: stranger, amount: '1000000', reason: refused.reason });
    expect(recorded.fromAddress).toBe(account('ana').address.toLowerCase());

    // The same R$ 1,00 to a wallet that went through the cadastro does land.
    const client = '0x00000000000000000000000000000000000c1e27';
    const allowed = await testTransfer(ctx, { wallet: client, amountBrl: '1.00' });
    expect(allowed).toMatchObject({ allowed: true, identified: true });
    expect(await balanceOf(client as Address)).toBe(1_000_000n);
    expect(await ctx.db.blockedAttempts()).toHaveLength(1);
  });

  it('gives the screens what happened: wallet, ledger, whitelist and reserves', async () => {
    await syncChain(ctx);
    const wallet = await walletView(ctx, 'ana');
    expect(wallet?.policy).toEqual({ id: '7', identified: { ok: true, value: true } });
    expect(wallet?.user.autoWithdraw).toBe(true);
    expect(wallet?.payments.map((p) => p.number)).toEqual(['0050', '0049', '0048', '0047']);
    expect(wallet?.payments.map((p) => p.withdrawal?.status ?? null)).toEqual([null, 'CONCLUIDO', null, 'CONCLUIDO']);
    // What a payment still has to take out: its own amount, unless the wallet holds less.
    expect(wallet?.payments.find((p) => p.number === '0048')?.withdrawable).toBe('53.85');
    expect(wallet?.payments.find((p) => p.number === '0047')?.withdrawable).toBeNull();

    const ops = await operationsView(ctx);
    const conversion = ops.find((op) => op.invoice?.number === '0047');
    expect(conversion).toMatchObject({ usd: '1540.00', rate: '5.3852', brl: '8293.26', withdrawal: { status: 'CONCLUIDO' } });
    expect(conversion?.withdrawal?.e2eId).toMatch(/^E99999999/);
    expect(ops.filter((op) => op.kind === 'saque').map((op) => op.withdrawal?.status).sort()).toEqual(['CONCLUIDO', 'DEVOLVIDO']);

    // (An anvil reused across runs remembers earlier RFQs on the list too; only ours count here.)
    const allowlist = await allowlistView(ctx);
    const ours = allowlist.entries.filter((e) => e.holder.kind !== 'outro');
    expect(ours.map((e) => e.holder.kind).sort()).toEqual(['cliente', 'cliente', 'rfq', 'tesouraria']);
    expect(ours.every((e) => e.identified.ok && e.identified.value && e.tx && e.since)).toBe(true);

    // Every Pix that went out was burned: the supply still equals the reais in the account.
    const reserves = await reservesView(ctx);
    expect(reserves.supply).toEqual({ ok: true, value: '1896.15' });
    expect(reserves.balance).toEqual({ ok: true, value: '1896.15' });
    expect(reserves.shortfall).toBe('0.00');
  });

  it('checks the exported report line by line against chain_events', async () => {
    const report = await reconcileReport(ctx);
    expect(report.findings).toEqual([]);
    expect(report.lines).toBeGreaterThan(2);
    expect(report.checks).toBeGreaterThan(report.lines);

    // And it bites: the same checks against a report somebody edited by hand.
    const lines = report.csv.split('\r\n');
    const withdrawn = lines.findIndex((line) => /,CONCLUIDO,/.test(line));
    expect(withdrawn).toBeGreaterThan(0);

    const wrongId = await checkReport(ctx, report.csv.replace(/E99999999(\d{12})SIM/, 'E99999999$1XXX'));
    expect(wrongId.findings[0].problem).toContain('the burn memo is');

    const wrongAmount = await checkReport(ctx, report.csv.replace(',8293.26,', ',8293.27,'));
    expect(wrongAmount.findings.map((f) => f.problem).join(' ')).toContain('the report says 8293.27');

    const invented = await checkReport(ctx, `${report.csv}${lines[withdrawn].replace(/0x[0-9a-f]{64}/g, `0x${'ab'.repeat(32)}`)}\r\n`);
    expect(invented.findings.map((f) => f.problem).join(' ')).toContain('not in chain_events');
  });

  it('leaves a withdrawal alone while its Pix is on the way', async () => {
    // Between the Pix leaving and the tBRL burning, the balance has already dropped and the
    // supply has not. The monitor has to count that as backing, or it pauses the token and
    // the burn can never run.
    // Above R$ 100 the simulator holds the Pix for a couple of seconds, like the sandbox.
    // One pass takes it as far as that, which is the window where the reais are already
    // gone and the tBRL is not burned yet.
    const { id } = await requestWithdrawal(ctx, { userId: 'ana', amountBrl: '120.00' });
    await syncChain(ctx);
    await tick(ctx);
    const midway = await ctx.db.withdrawal(id);
    expect(['PIX_ENVIADO', 'PIX_CONFIRMADO']).toContain(midway?.status);

    const reading = await monitorReserves(ctx, true);
    expect(reading).toMatchObject({ ok: true, paused: false, inFlightBrl: '120.00' });
    expect(await isPaused(ctx)).toBe(false);

    expect((await untilFinal(id)).status).toBe('CONCLUIDO');
    expect((await monitorReserves(ctx, true))?.inFlightBrl).toBe('0.00');
  });

  it('pauses the token when the supply outgrows its backing, and puts it back', async () => {
    expect((await monitorReserves(ctx, true))?.ok).toBe(true);
    expect(await isPaused(ctx)).toBe(false);

    const broken = await breakReserve(ctx, '1000.00');
    expect(broken.shortfallBrl).toBe('1000.00');

    const caught = await monitorReserves(ctx, true);
    expect(caught).toMatchObject({ ok: false, shortfallBrl: '1000.00', paused: true, pausedNow: true });
    expect(await isPaused(ctx)).toBe(true);
    expect((await ctx.db.lastReserveCheck())?.ok).toBe(false);
    await syncChain(ctx); // the pause is an event like any other; the console reads it from here
    expect(await ctx.db.lastPauseChange()).toMatchObject({ paused: true });

    // Nothing moves while it is paused, which is the point of pausing.
    await expect(requestWithdrawal(ctx, { userId: 'ana', amountBrl: '1.00' })).rejects.toThrow();

    const back = await restoreReserve(ctx);
    expect(back).toMatchObject({ ok: true, burnedBrl: '1000.00', shortfallBrl: '0.00' });
    expect(await isPaused(ctx)).toBe(false);
    expect((await monitorReserves(ctx, true))?.ok).toBe(true);
  });

  // Last, because it clears what every test above it built.
  it('puts the demo back to its first frame, with the Pix account topped up', async () => {
    const spent = await ctx.pix.balance();
    expect(Number(spent.availableBrl)).toBeLessThan(10_000);

    const report = await resetDemo(ctx, { inventoryBrl: '10000' });
    expect(report.balanceBrl).toBe('10000.00');
    expect(report.toppedUpBrl).not.toBe('0.00');

    // What a client holds is theirs; the stock is whatever is left of the backing.
    const stranded = Number(report.strandedBrl);
    expect(stranded).toBeGreaterThan(0);
    expect(Number(report.inventoryBrl) + stranded).toBe(Number(report.supplyAfter));
    expect(Number(report.supplyAfter)).toBeLessThanOrEqual(Number(report.balanceBrl));

    const invoice = await ctx.db.invoice('fatura-0047');
    expect(invoice).toMatchObject({ status: 'aberta', paidAt: null, amountUsd: '1540.00' });
    expect(await ctx.db.withdrawalsOf('ana')).toEqual([]);
    expect(await ctx.db.quotesForInvoice('fatura-0047')).toEqual([]);
    expect((await ctx.db.user('ana'))?.autoWithdrawSince).toBeNull();
    expect((await monitorReserves(ctx, true))?.ok).toBe(true);

    // And it is cheap to run again when nothing moved since.
    const again = await resetDemo(ctx, { inventoryBrl: '10000' });
    expect(again.txs).toEqual([]);
  });
});
