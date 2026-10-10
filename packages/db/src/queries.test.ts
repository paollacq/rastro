import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { connect, type Sql } from './client.ts';
import { migrate } from './migrate.ts';
import { queries, type Queries } from './queries.ts';

// Runs against a throwaway database: TEST_DATABASE_URL=postgres://... pnpm --filter @rastro/db test
const url = process.env.TEST_DATABASE_URL;

describe.skipIf(!url)('queries', () => {
  let sql: Sql;
  let q: Queries;

  beforeAll(async () => {
    sql = connect(url);
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
});
