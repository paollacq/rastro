import { afterEach, describe, expect, it, vi } from 'vitest';
import { endToEndFormat } from './e2e.ts';
import { PayZu, PayZuProvider } from './payzu.ts';
import { fromCents, toCents } from './provider.ts';
import { signCallback, verifyCallback } from './signature.ts';
import { memoryStore, PixSimulator, simulatedEndToEndId } from './simulator.ts';

describe('centavos', () => {
  it.each([
    ['8274.42', 827_442n],
    ['150', 15_000n],
    ['0.5', 50n],
    ['10.00', 1_000n],
  ])('reads %s', (text, cents) => {
    expect(toCents(text)).toBe(cents);
  });

  it('refuses fractions of a centavo and junk', () => {
    expect(() => toCents('1.234')).toThrow();
    expect(() => toCents('-1')).toThrow();
    expect(() => toCents('1,50')).toThrow();
  });

  it('writes two decimals', () => {
    expect(fromCents(827_442n)).toBe('8274.42');
    expect(fromCents(5n)).toBe('0.05');
  });
});

describe('X-Callback-Signature', () => {
  const secret = 'EOvBvLmIqjcIg13T2_cf8NXn7K5txbakb053ZY8sPrA';
  const body = '{"id":"tx_1","status":"COMPLETED","endToEndId":"E17916580821078hi6hh"}';
  const now = 1_791_658_100_000;
  const t = Math.floor(now / 1000);

  it('accepts what PayZu would send', () => {
    expect(verifyCallback(signCallback(secret, body, t), body, secret, now)).toBe(true);
  });

  it('rejects a body changed after signing', () => {
    const header = signCallback(secret, body, t);
    expect(verifyCallback(header, body.replace('COMPLETED', 'CANCELED'), secret, now)).toBe(false);
  });

  it('rejects another secret, a stale timestamp and a missing header', () => {
    expect(verifyCallback(signCallback('other', body, t), body, secret, now)).toBe(false);
    expect(verifyCallback(signCallback(secret, body, t - 301), body, secret, now)).toBe(false);
    expect(verifyCallback(undefined, body, secret, now)).toBe(false);
    expect(verifyCallback(signCallback(secret, body, t), body, undefined, now)).toBe(false);
  });
});

describe('simulator', () => {
  let clock = new Date('2026-10-10T19:00:00Z');
  const now = () => clock;
  const make = (onSettled = vi.fn()) => ({
    pix: new PixSimulator(memoryStore(), { now, delayMs: 2_500, onSettled }),
    onSettled,
  });

  it('issues official-format IDs from institution 99999999 that start their random part with SIM', () => {
    const id = simulatedEndToEndId(clock);
    expect(endToEndFormat(id)).toBe('official');
    expect(id.startsWith('E99999999202610101900SIM')).toBe(true);
  });

  it('holds a withdrawal above R$ 100 for a moment, then settles it once', async () => {
    const { pix, onSettled } = make();
    const sent = await pix.createWithdrawal({ amountBrl: '8274.42', pixKey: 'ana@example.com', pixKeyType: 'email', reference: 'saque-a' });
    expect(sent.status).toBe('PENDING');
    expect(sent.endToEndId).toBeNull();

    clock = new Date(clock.getTime() + 2_500);
    const settled = await pix.findWithdrawal('saque-a');
    expect(settled?.status).toBe('COMPLETED');
    expect(settled?.endToEndId).toMatch(/^E99999999\d{12}SIM/);
    expect(await pix.findWithdrawal('saque-a')).toEqual(settled);
    expect(onSettled).toHaveBeenCalledTimes(1);
  });

  it('settles R$ 10 to R$ 100 at once and cancels under R$ 10', async () => {
    const { pix } = make();
    expect((await pix.createWithdrawal({ amountBrl: '100.00', pixKey: 'k', pixKeyType: 'email', reference: 'r1' })).status).toBe('COMPLETED');
    expect((await pix.createWithdrawal({ amountBrl: '9.99', pixKey: 'k', pixKeyType: 'email', reference: 'r2' })).status).toBe('FAILED');
  });

  it('never sends twice for the same reference', async () => {
    const { pix } = make();
    const first = await pix.createWithdrawal({ amountBrl: '50', pixKey: 'k', pixKeyType: 'email', reference: 'same' });
    const second = await pix.createWithdrawal({ amountBrl: '50', pixKey: 'k', pixKeyType: 'email', reference: 'same' });
    expect(second.id).toBe(first.id);
    expect((await pix.balance()).availableBrl).toBe('9950.00');
  });

  it('keeps a balance like a fresh sandbox credential', async () => {
    const { pix } = make();
    await pix.createCharge({ amountBrl: '25', reference: 'in' });
    await pix.createWithdrawal({ amountBrl: '150', pixKey: 'k', pixKeyType: 'email', reference: 'out' });
    expect((await pix.balance()).availableBrl).toBe('9850.00'); // the charge is still pending
    clock = new Date(clock.getTime() + 2_500);
    await pix.findWithdrawal('out');
    await pix.createCharge({ amountBrl: '25', reference: 'in' }); // same reference: settles the first one
    expect((await pix.balance()).availableBrl).toBe('9875.00');
  });
});

describe('PayZu provider', () => {
  afterEach(() => vi.unstubAllGlobals());

  const reply = (status: number, body: unknown) =>
    vi.fn(async () => new Response(body === undefined ? '' : JSON.stringify(body), { status }));

  it('treats a 404 on lookup as "never sent"', async () => {
    vi.stubGlobal('fetch', reply(404, { message: 'not found' }));
    expect(await new PayZuProvider(new PayZu('sbx_test')).findWithdrawal('saque-x')).toBeNull();
  });

  it('maps statuses and keeps the ID as PayZu sent it', async () => {
    vi.stubGlobal(
      'fetch',
      reply(200, {
        id: 'cmh2',
        status: 'COMPLETED',
        type: 'WITHDRAW',
        amount: 8274.42,
        endToEndId: 'E1791658094571pszbnm',
        clientReference: 'saque-x',
        createdAt: '2026-10-10T18:48:04Z',
        paidAt: '2026-10-10T18:48:14Z',
      }),
    );
    const found = await new PayZuProvider(new PayZu('sbx_test')).findWithdrawal('saque-x');
    expect(found).toEqual({
      id: 'cmh2',
      reference: 'saque-x',
      status: 'COMPLETED',
      providerStatus: 'COMPLETED',
      amountBrl: '8274.42',
      endToEndId: 'E1791658094571pszbnm',
    });
  });

  it('sends reais as a number with the reference', async () => {
    const fetch = reply(200, { id: 'w1', status: 'PENDING', type: 'WITHDRAW', amount: 150, endToEndId: null, clientReference: 'saque-y' });
    vi.stubGlobal('fetch', fetch);
    await new PayZuProvider(new PayZu('sbx_test')).createWithdrawal({ amountBrl: '150.00', pixKey: 'ana@example.com', pixKeyType: 'email', reference: 'saque-y' });
    const [url, init] = fetch.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe('https://pix.sandbox.payzu.dev/v1/withdraw');
    expect(JSON.parse(String(init.body))).toMatchObject({ amount: 150, pixKey: 'ana@example.com', pixType: 'email', clientReference: 'saque-y' });
  });
});
