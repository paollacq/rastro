import { readMemo } from '@rastro/chain';
import type { NewPixEvent, Queries } from '@rastro/db';
import { signCallback } from '@rastro/pix';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { Context } from './context.ts';
import { baseToBrl, brlToBase, floorToCents, newId } from './money.ts';
import { burnMemo, refundMemoText } from './orchestrator.ts';
import { clearPtaxCache, latestPtax, parsePtax, ptaxUrl } from './ptax.ts';
import { brasiliaTime, operationsCsv } from './report.ts';
import { effectiveRate, type OperationRow } from './views.ts';
import { handlePixWebhook } from './webhook.ts';

describe('money', () => {
  it('rounds base units down to the centavo', () => {
    expect(floorToCents(8_293_267_290n)).toBe(8_293_260_000n);
  });

  it('converts between reais and base units', () => {
    expect(brlToBase('8293.26')).toBe(8_293_260_000n);
    expect(baseToBrl(8_293_260_000n)).toBe('8293.26');
    expect(() => baseToBrl(1n)).toThrow();
  });

  it('makes short readable ids that fit a memo with room to spare', () => {
    const id = newId('saque');
    expect(id).toMatch(/^saque-[a-z0-9]{8}$/);
    expect(refundMemoText(id).length).toBeLessThanOrEqual(32);
  });
});

describe('console rate', () => {
  it('is reais paid out per dollar, PTAX less the spread after the centavo rounding', () => {
    // 1,540.00 at 5.4123 less 0.50% = R$ 8,293.26
    expect(effectiveRate('8293260000', '1540000000')).toBe('5.3852');
    expect(effectiveRate('5000000', '1000000')).toBe('5.0000');
  });
});

describe('operations report', () => {
  const row: OperationRow = {
    kind: 'conversao',
    at: '2026-10-10T21:25:39.000Z',
    client: { name: 'Ana Ribeiro', cpfMasked: '***.456.789-**', wallet: '0x70997970c51812dc3a010c7d01b50e0d17dc79c8', pixKeyMasked: 'a•••@example.com' },
    invoice: { id: 'fatura-0047', number: '0047', payerName: 'Bramble & Pike Software, Inc.', payerWallet: '0x90f79bf6eb2c4f870365e785982e1f101e93b906' },
    usd: '1540.00',
    ptax: { rate: '5.4123', date: '2026-10-09', spreadBps: 50 },
    rate: '5.3852',
    brl: '8293.26',
    withdrawal: { id: 'saque-k3j9x2m1', status: 'CONCLUIDO', amountBrl: '8293.26', e2eId: 'E99999999202610111520SIMa1b2c3d4', provider: 'simulator' },
    fillTx: '0xfill',
    transferTx: '0xtransfer',
    burnTx: '0xburn',
  };

  it('writes Brasília time with its offset', () => {
    expect(brasiliaTime('2026-10-10T21:25:39.000Z')).toBe('2026-10-10T18:25:39-03:00');
  });

  it('quotes the fields that need it and leaves empty what does not apply', () => {
    const [header, line, end] = operationsCsv([row, { ...row, kind: 'saque', invoice: null, usd: null, ptax: null, rate: null, brl: null, fillTx: null }]).split('\r\n');
    expect(header.split(',')).toHaveLength(23);
    expect(line).toBe(
      '2026-10-10T18:25:39-03:00,conversion,Ana Ribeiro,***.456.789-**,0x70997970c51812dc3a010c7d01b50e0d17dc79c8,a•••@example.com,' +
        '"Bramble & Pike Software, Inc.",0x90f79bf6eb2c4f870365e785982e1f101e93b906,fatura-0047,1540.00,2026-10-09,5.4123,50,5.3852,8293.26,' +
        'saque-k3j9x2m1,CONCLUIDO,8293.26,E99999999202610111520SIMa1b2c3d4,simulator,0xfill,0xtransfer,0xburn',
    );
    expect(end.startsWith('2026-10-10T18:25:39-03:00,withdrawal,Ana Ribeiro,')).toBe(true);
    expect(end.split(',').slice(6, 15)).toEqual(['', '', '', '', '', '', '', '', '']);
  });
});

describe('burn memo', () => {
  it.each(['E17916580821078hi6hh', 'E99999999202610101900SIMa1b2c3d4'])('carries %s itself, readable on the explorer', (id) => {
    expect(readMemo(burnMemo(id))).toBe(id);
  });

  it('falls back to a hash only for something that cannot be a memo', () => {
    expect(burnMemo('x'.repeat(40))).toMatch(/^0x[0-9a-f]{64}$/);
  });
});

describe('PTAX', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.unstubAllEnvs();
    clearPtaxCache();
  });

  it('asks the BCB for the last ten days, dates as MM-DD-YYYY, in Brazilian time', () => {
    const url = ptaxUrl(new Date('2026-10-10T02:00:00Z')); // still the 9th in Brasília
    expect(url).toContain("@dataInicial='09-29-2026'");
    expect(url).toContain("@dataFinalCotacao='10-09-2026'");
  });

  it('takes the latest day in the answer', () => {
    const ptax = parsePtax({
      value: [
        { cotacaoCompra: 5.3901, dataHoraCotacao: '2026-10-08 13:06:28.123' },
        { cotacaoCompra: 5.4123, dataHoraCotacao: '2026-10-09 13:04:29.441' },
      ],
    });
    expect(ptax).toEqual({ rate: '5.4123', date: '2026-10-09', source: 'bcb' });
  });

  it('falls back to the last rate used when the BCB is down', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response('down', { status: 503 })));
    const ptax = await latestPtax({ fallback: async () => ({ rate: '5.4000', date: '2026-10-08' }) });
    expect(ptax).toEqual({ rate: '5.4000', date: '2026-10-08', source: 'last-used' });
  });

  it('can be pinned for a recording', async () => {
    vi.stubEnv('PTAX_OVERRIDE', '5.4123@2026-10-09');
    expect(await latestPtax()).toEqual({ rate: '5.4123', date: '2026-10-09', source: 'override' });
  });
});

describe('Pix webhook', () => {
  const secret = 'whsec_test';
  const stored: NewPixEvent[] = [];
  const ctx = {
    webhookSecret: secret,
    now: () => new Date(),
    db: {
      insertPixEvent: async (event: NewPixEvent) => {
        if (stored.some((e) => e.providerTxId === event.providerTxId && e.event === event.event)) return false;
        stored.push(event);
        return true;
      },
    } as unknown as Queries,
  } as Context;
  const headers = (map: Record<string, string>) => (name: string) => map[name.toLowerCase()] ?? null;
  const body = JSON.stringify({
    id: 'cmh2',
    status: 'COMPLETED',
    type: 'WITHDRAW',
    clientReference: 'saque-k3j9x2m1',
    endToEndId: 'E1791658094571pszbnm',
  });

  it('answers the ownership challenge by echoing the token', async () => {
    const res = await handlePixWebhook(ctx, { rawBody: '{}', header: headers({ 'x-callback-challenge': 'tok_123' }) });
    expect(res).toEqual({ status: 200, body: { challenge: 'tok_123' } });
  });

  it('refuses an unsigned or forged delivery without storing anything', async () => {
    const forged = signCallback('not-the-secret', body);
    expect((await handlePixWebhook(ctx, { rawBody: body, header: headers({}) })).status).toBe(401);
    expect((await handlePixWebhook(ctx, { rawBody: body, header: headers({ 'x-callback-signature': forged }) })).status).toBe(401);
    expect(stored).toHaveLength(0);
  });

  it('stores a signed delivery once, however many times it arrives', async () => {
    const signed = headers({ 'x-callback-signature': signCallback(secret, body), 'x-callback-event': 'TRANSACTION_COMPLETED' });
    expect(await handlePixWebhook(ctx, { rawBody: body, header: signed })).toEqual({ status: 200, body: { ok: true, duplicate: false } });
    expect(await handlePixWebhook(ctx, { rawBody: body, header: signed })).toEqual({ status: 200, body: { ok: true, duplicate: true } });
    expect(stored).toHaveLength(1);
    expect(stored[0]).toMatchObject({ reference: 'saque-k3j9x2m1', e2eId: 'E1791658094571pszbnm', status: 'COMPLETED' });
  });
});
