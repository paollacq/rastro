import type { ChainEvent } from '@rastro/db';
import { describe, expect, it } from 'vitest';
import type { Trace, TraceWithdrawal } from './trace.ts';
import { trailOf } from './trail.ts';

const OFFICIAL = 'E99999999202610101806SIMa1b2c3d4';
const SANDBOX = 'E1791665365006pczpkc';

function event(over: Partial<ChainEvent>): ChainEvent {
  return {
    txHash: '0xfill',
    logIndex: 0,
    blockNumber: '100',
    blockTime: new Date('2026-10-10T21:05:00Z'),
    contract: '0xtoken',
    event: 'TransferWithMemo',
    fromAddress: null,
    toAddress: null,
    amount: null,
    memo: null,
    memoText: null,
    args: {},
    ...over,
  };
}

function invoiceTrace(over: Partial<Trace> = {}, paid = true): Trace {
  return {
    explorer: 'https://explore.testnet.tempo.xyz',
    invoice: {
      id: 'fatura-0047',
      number: '0047',
      payerName: 'Bramble & Pike Software, Inc.',
      recipientName: 'Ana Ribeiro',
      description: 'Backend, setembro: 28 h × US$ 55',
      amountUsd: '1540.00',
      status: paid ? 'paga' : 'aberta',
      issuedAt: new Date('2026-10-10T20:00:00Z'),
      paidAt: paid ? new Date('2026-10-10T21:05:02Z') : null,
    },
    quote: {
      id: 'cot-1',
      ptaxRate: '5.4123',
      ptaxDate: '2026-10-09',
      spreadBps: 50,
      usdIn: '1540.00',
      brlOut: '8293.26',
      expiresAt: '2026-10-10T21:05:30Z',
      fillTx: paid ? '0xfill' : null,
    },
    payment: paid ? [event({ event: 'Filled', memoText: 'fatura-0047' })] : [],
    withdrawals: [],
    ...over,
  };
}

function withdrawal(status: TraceWithdrawal['status'], over: Partial<TraceWithdrawal> = {}): TraceWithdrawal {
  const order: TraceWithdrawal['status'][] = ['SOLICITADO', 'TBRL_NA_TESOURARIA', 'PIX_ENVIADO', 'PIX_CONFIRMADO', 'QUEIMADO', 'CONCLUIDO'];
  const failed: TraceWithdrawal['status'][] = ['SOLICITADO', 'TBRL_NA_TESOURARIA', 'PIX_ENVIADO', 'FALHOU', 'DEVOLVIDO'];
  const path: TraceWithdrawal['status'][] = order.includes(status) ? order : status === 'CANCELADO' ? ['SOLICITADO', 'CANCELADO'] : failed;
  const steps = path
    .slice(0, path.indexOf(status) + 1)
    .map((s, i) => ({ status: s, detail: null, at: new Date(Date.parse('2026-10-11T15:20:00Z') + i * 3_000) }));
  return {
    id: 'saque-k3j9x2m1',
    status,
    createdAt: new Date('2026-10-11T15:20:00Z'),
    amountBrl: '8293.26',
    pixKeyMasked: 'a•••@example.com',
    provider: 'simulator',
    e2eId: null,
    e2eFormat: null,
    failure: null,
    steps,
    transfer: [event({ txHash: '0xtransfer', memoText: 'saque-k3j9x2m1' })],
    burn: [],
    refund: [],
    pix: [],
    burnMemoMatchesPix: null,
    ...over,
  };
}

const states = (trace: Trace) => trailOf(trace).steps.map((s) => `${s.key}:${s.state}`);

describe('trailOf', () => {
  it('an open invoice: issued, the rest waiting, and the page keeps asking', () => {
    const trail = trailOf(invoiceTrace({}, false));
    expect(trail.steps.map((s) => `${s.key}:${s.state}`)).toEqual([
      'emitida:feito',
      'paga:esperando',
      'convertida:esperando',
      'carteira:esperando',
      'pix:esperando',
      'queima:esperando',
    ]);
    expect(trail.settled).toBe(false);
  });

  it('a paid invoice: the dollars, the conversion and the tBRL share one fill and one time', () => {
    const trail = trailOf(invoiceTrace());
    const [, paga, convertida, carteira] = trail.steps;
    expect([paga.state, convertida.state, carteira.state]).toEqual(['feito', 'feito', 'feito']);
    expect(paga.tx).toBe('0xfill');
    expect(convertida.at).toBe('2026-10-10T21:05:00.000Z');
    expect(carteira.at).toBe(paga.at);
    expect(trail.steps[4]).toMatchObject({ key: 'pix', state: 'esperando' });
  });

  it('a Pix on its way is the step in progress', () => {
    expect(states(invoiceTrace({ withdrawals: [withdrawal('PIX_ENVIADO')] })).slice(4)).toEqual(['pix:agora', 'queima:esperando']);
    expect(states(invoiceTrace({ withdrawals: [withdrawal('PIX_CONFIRMADO')] })).slice(4)).toEqual(['pix:feito', 'queima:agora']);
  });

  it('a finished withdrawal compares the Pix ID with the burn memo, all 32 characters', () => {
    const done = withdrawal('CONCLUIDO', {
      e2eId: OFFICIAL,
      e2eFormat: 'official',
      burn: [event({ txHash: '0xburn', memoText: OFFICIAL, memo: '0x45', blockTime: new Date('2026-10-11T15:20:14Z') })],
    });
    const trail = trailOf(invoiceTrace({ withdrawals: [done] }));
    expect(trail.steps.at(-1)).toEqual({ key: 'queima', state: 'feito', at: '2026-10-11T15:20:14.000Z', tx: '0xburn' });
    expect(trail.comparison).toMatchObject({ equal: 32, length: 32, matches: true, format: 'official' });
    expect(trail.settled).toBe(true);
  });

  it('a sandbox ID matches on its own 20 characters', () => {
    const done = withdrawal('CONCLUIDO', {
      provider: 'payzu-sandbox',
      e2eId: SANDBOX,
      e2eFormat: 'sandbox',
      burn: [event({ txHash: '0xburn', memoText: SANDBOX })],
    });
    expect(trailOf(invoiceTrace({ withdrawals: [done] })).comparison).toMatchObject({ equal: 20, length: 20, matches: true });
  });

  it('a memo one character off is counted, not stamped', () => {
    const done = withdrawal('CONCLUIDO', {
      e2eId: OFFICIAL,
      burn: [event({ txHash: '0xburn', memoText: `${OFFICIAL.slice(0, 31)}X` })],
    });
    expect(trailOf(invoiceTrace({ withdrawals: [done] })).comparison).toMatchObject({ equal: 31, matches: false });
  });

  it('waits for the burn event even when the status already says CONCLUIDO', () => {
    const trail = trailOf(invoiceTrace({ withdrawals: [withdrawal('CONCLUIDO', { e2eId: OFFICIAL })] }));
    expect(trail.comparison).toBeNull();
    expect(trail.settled).toBe(false);
  });

  it('a refused Pix turns red and the money coming back is the last step', () => {
    expect(states(invoiceTrace({ withdrawals: [withdrawal('FALHOU')] })).slice(4)).toEqual(['pix:falhou', 'devolvida:agora']);
    const back = withdrawal('DEVOLVIDO', { refund: [event({ txHash: '0xrefund', memoText: 'devolucao saque-k3j9x2m1' })] });
    const trail = trailOf(invoiceTrace({ withdrawals: [back] }));
    expect(trail.steps.at(-1)).toMatchObject({ key: 'devolvida', state: 'feito', tx: '0xrefund' });
    expect(trail.settled).toBe(true);
  });

  it('a cancelled withdrawal ends at the Pix step, with nothing to burn or give back', () => {
    const trail = trailOf(invoiceTrace({ withdrawals: [withdrawal('CANCELADO')] }));
    expect(trail.steps.slice(4).map((s) => `${s.key}:${s.state}`)).toEqual(['pix:falhou']);
    expect(trail.settled).toBe(true);
  });

  it('follows the latest withdrawal that moved money and lists the others', () => {
    const old = withdrawal('DEVOLVIDO', { id: 'saque-antigo0' });
    const now = withdrawal('PIX_ENVIADO', { id: 'saque-novo0000' });
    const cancelled = withdrawal('CANCELADO', { id: 'saque-cancel00' });
    const trail = trailOf(invoiceTrace({ withdrawals: [old, now, cancelled] }));
    expect(trail.withdrawal?.id).toBe('saque-novo0000');
    expect(trail.others.map((w) => w.id)).toEqual(['saque-antigo0', 'saque-cancel00']);
  });

  it('a withdrawal with no invoice starts in the wallet', () => {
    const trail = trailOf({ ...invoiceTrace(), invoice: null, quote: null, payment: [], withdrawals: [withdrawal('PIX_ENVIADO')] });
    expect(trail.steps.map((s) => s.key)).toEqual(['carteira', 'pix', 'queima']);
  });

  it('reads dates that arrived as JSON strings', () => {
    const wire = JSON.parse(JSON.stringify(invoiceTrace())) as Trace;
    expect(trailOf(wire).steps[0].at).toBe('2026-10-10T20:00:00.000Z');
  });
});
