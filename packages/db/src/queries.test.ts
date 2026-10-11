import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { connect, type Sql } from './client.ts';
import { migrate } from './migrate.ts';
import { queries, type Queries } from './queries.ts';
import { assertThrowawayDatabase } from './testing.ts';

// Runs against a throwaway database: TEST_DATABASE_URL=postgres://... pnpm --filter @rastro/db test
// The first thing it does is drop the schema, so the URL has to be a disposable one.
const url = process.env.TEST_DATABASE_URL;

describe.skipIf(!url)('queries', () => {
  let sql: Sql;
  let q: Queries;

  beforeAll(async () => {
    sql = connect(assertThrowawayDatabase(url, 'o teste do @rastro/db'));
    await sql.unsafe('drop schema if exists public cascade; create schema public;');
    await migrate(sql);
    await migrate(sql); // twice on purpose
    q = queries(sql);
    await q.upsertUser({ id: 'ana', role: 'recebedora', name: 'Ana Ribeiro', wallet: '0xAbC0000000000000000000000000000000000001', pixKey: 'ana@example.com', pixKeyType: 'email', pixKeyMasked: 'a***@example.com' });
    await q.upsertInvoice({ id: 'fatura-0047', number: '0047', payerName: 'Bramble & Pike Software, Inc.', payerWallet: '0x00000000000000000000000000000000000000b1', recipientId: 'ana', description: 'Backend, setembro: 28 h × US$ 55', amountUsd: '1540.00' });
  });

  afterAll(async () => {
    await sql?.end();
  });

  it('reads rows back camelCased, with numerics as strings', async () => {
    const invoice = await q.invoice('fatura-0047');
    expect(invoice).toMatchObject({ number: '0047', amountUsd: '1540.00', status: 'aberta', recipientId: 'ana' });
    expect(await q.userByWallet('0xabc0000000000000000000000000000000000001')).toMatchObject({ id: 'ana' });
  });

  it('stores a 256-bit nonce without losing digits', async () => {
    const nonce = (2n ** 255n + 12345n).toString();
    await q.insertQuote({
      id: 'cot-1', invoiceId: 'fatura-0047', payer: '0x00000000000000000000000000000000000000b1',
      recipient: '0xAbC0000000000000000000000000000000000001', ptaxDate: '2026-10-09', ptaxRate: '5.4123', spreadBps: 50,
      usdIn: '1540000000', brlOut: '8293260000', invoiceRef: 'fatura-0047', nonce,
      expiry: new Date('2026-10-10T19:00:30Z'), signature: '0xsig',
    });
    expect((await q.quote('cot-1'))?.nonce).toBe(nonce);
    expect(await q.lastPtax()).toEqual({ ptaxDate: '2026-10-09', ptaxRate: '5.4123' });
  });

  it('moves a withdrawal only from the status it is in, and logs every step', async () => {
    await q.insertWithdrawal({ id: 'saque-test0001', userId: 'ana', invoiceId: 'fatura-0047', amountBrl: '8274420000' }, 'pedido');
    const moved = await q.advance('saque-test0001', 'SOLICITADO', 'TBRL_NA_TESOURARIA', { transferTx: '0xaa' }, 'chegou');
    expect(moved).toMatchObject({ status: 'TBRL_NA_TESOURARIA', transferTx: '0xaa' });
    expect(await q.advance('saque-test0001', 'SOLICITADO', 'TBRL_NA_TESOURARIA', {}, 'de novo')).toBeNull();
    expect((await q.steps('saque-test0001')).map((s) => s.status)).toEqual(['SOLICITADO', 'TBRL_NA_TESOURARIA']);
    expect((await q.openWithdrawals()).map((w) => w.id)).toContain('saque-test0001');
  });

  it('ignores chain events it already has and finds a transfer by memo', async () => {
    const event = {
      txHash: '0xaa', logIndex: 1, blockNumber: '100', blockTime: new Date(), contract: '0x20c0000000000000000000000000000000000abc',
      event: 'TransferWithMemo', fromAddress: '0xabc0000000000000000000000000000000000001', toAddress: '0x00000000000000000000000000000000000000ee',
      amount: '8274420000', memo: '0x...', memoText: 'saque-test0001', args: { amount: '8274420000' },
    };
    expect(await q.insertChainEvents([event])).toBe(1);
    expect(await q.insertChainEvents([event])).toBe(0);
    const found = await q.findMemoTransfer({ contract: '0x20C0000000000000000000000000000000000ABC', to: '0x00000000000000000000000000000000000000EE', memoText: 'saque-test0001' });
    expect(found).toMatchObject({ txHash: '0xaa', amount: '8274420000', args: { amount: '8274420000' } });
    expect(await q.chainEventsForTxs(['0xAA'])).toHaveLength(1);
  });

  it('keeps one Pix event per transaction and event type', async () => {
    const event = { provider: 'payzu-sandbox', providerTxId: 'cmh2', event: 'TRANSACTION_COMPLETED', reference: 'saque-test0001', e2eId: 'E1791658094571pszbnm', status: 'COMPLETED', payload: { id: 'cmh2' }, signatureOk: true };
    expect(await q.insertPixEvent(event)).toBe(true);
    expect(await q.insertPixEvent(event)).toBe(false);
    expect(await q.pixEvents({ reference: 'saque-test0001' })).toHaveLength(1);
  });

  it('remembers worker state', async () => {
    expect(await q.state('cursor')).toBeNull();
    await q.setState('cursor', '100');
    await q.setState('cursor', '200');
    expect(await q.state('cursor')).toBe('200');
  });

  it('stores invoice lines as JSON and keeps the first time an invoice was paid', async () => {
    await q.upsertInvoice({
      id: 'fatura-0047', number: '0047', payerName: 'Bramble & Pike Software, Inc.', payerWallet: '0x00000000000000000000000000000000000000b1',
      recipientId: 'ana', description: 'Backend, setembro: 28 h × US$ 55', amountUsd: '1540.00',
      items: [{ description: 'Backend work, September', hours: 28, rateUsd: '55.00' }],
    });
    expect((await q.invoiceByNumber('0047'))?.items).toEqual([{ description: 'Backend work, September', hours: 28, rateUsd: '55.00' }]);
    await q.setQuoteFill('cot-1', '0xFILL');
    await q.markInvoicePaid('fatura-0047', new Date('2026-10-10T21:05:00Z'));
    await q.markInvoicePaid('fatura-0047', new Date('2026-10-10T21:09:00Z')); // the watcher, later
    expect((await q.invoice('fatura-0047'))?.paidAt?.toISOString()).toBe('2026-10-10T21:05:00.000Z');
  });

  it('lists conversions with their withdrawal, and withdrawals on their own, newest first', async () => {
    await q.insertWithdrawal({ id: 'saque-avulso01', userId: 'ana', invoiceId: null, amountBrl: '150000000' }, 'pedido');
    const ops = await q.operations();
    expect(ops.map((op) => [op.kind, op.withdrawalId])).toEqual([
      ['saque', 'saque-avulso01'],
      ['conversao', 'saque-test0001'],
    ]);
    expect(ops[1]).toMatchObject({ clientName: 'Ana Ribeiro', usdIn: '1540000000', brlOut: '8293260000', ptaxRate: '5.4123', fillTx: '0xFILL' });
    expect(await q.operations({ to: new Date('2026-10-10T00:00:00Z') })).toEqual([]);
    expect((await q.paymentsTo('ana')).map((p) => p.invoiceId)).toEqual(['fatura-0047']);
  });

  it('allows one withdrawal in flight per invoice', async () => {
    const second = { id: 'saque-test0002', userId: 'ana', invoiceId: 'fatura-0047', amountBrl: '1000000' };
    await expect(q.insertWithdrawal(second, 'pedido')).rejects.toMatchObject({ code: '23505' });
    await q.advance('saque-test0001', 'TBRL_NA_TESOURARIA', 'FALHOU', {}, 'recusado');
    await expect(q.insertWithdrawal(second, 'pedido')).rejects.toMatchObject({ code: '23505' });
    await q.advance('saque-test0001', 'FALHOU', 'DEVOLVIDO', {}, 'devolvido');
    await expect(q.insertWithdrawal(second, 'pedido')).resolves.toMatchObject({ status: 'SOLICITADO' });
  });

  it('withdraws automatically only what was paid after it was turned on, once', async () => {
    const since = (await q.setAutoWithdraw('ana', true))?.autoWithdrawSince;
    expect(since).toBeInstanceOf(Date);
    expect((await q.setAutoWithdraw('ana', true))?.autoWithdrawSince).toEqual(since); // switching it on again keeps the date
    await q.upsertInvoice({ id: 'fatura-0048', number: '0048', payerName: 'Bramble & Pike Software, Inc.', payerWallet: '0x00000000000000000000000000000000000000b1', recipientId: 'ana', description: 'Backend, outubro', amountUsd: '880.00' });
    await q.insertQuote({
      id: 'cot-2', invoiceId: 'fatura-0048', payer: '0x00000000000000000000000000000000000000b1', recipient: '0xAbC0000000000000000000000000000000000001',
      ptaxDate: '2026-10-09', ptaxRate: '5.4123', spreadBps: 50, usdIn: '880000000', brlOut: '4739000000', invoiceRef: 'fatura-0048',
      nonce: '42', expiry: new Date(), signature: '0xsig',
    });
    expect(await q.autoWithdrawDue()).toEqual([]); // not paid yet; 0047 was paid before
    await q.setQuoteFill('cot-2', '0xfill2');
    await q.markInvoicePaid('fatura-0048', new Date(Date.now() + 1_000));
    expect(await q.autoWithdrawDue()).toEqual([{ invoiceId: 'fatura-0048', userId: 'ana', brlOut: '4739000000' }]);
    await q.insertWithdrawal({ id: 'saque-auto0001', userId: 'ana', invoiceId: 'fatura-0048', amountBrl: '4739000000' }, 'automático');
    expect(await q.autoWithdrawDue()).toEqual([]);
    expect((await q.setAutoWithdraw('ana', false))?.autoWithdrawSince).toBeNull();
  });

  it('keeps one waitlist entry per address', async () => {
    expect(await q.joinWaitlist({ email: 'alguem@example.com', relation: 'recebo', lang: 'pt' })).toBe(true);
    expect(await q.joinWaitlist({ email: 'alguem@example.com', relation: null, lang: 'en' })).toBe(false);
  });
});
