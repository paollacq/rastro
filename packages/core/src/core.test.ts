import { readMemo } from '@rastro/chain';
import type { NewPixEvent, Queries } from '@rastro/db';
import { signCallback } from '@rastro/pix';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { Context } from './context.ts';
import { baseToBrl, brlToBase, floorToCents, newId } from './money.ts';
import { burnMemo, refundMemoText } from './orchestrator.ts';
import { clearPtaxCache, latestPtax, parsePtax, ptaxUrl } from './ptax.ts';
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
