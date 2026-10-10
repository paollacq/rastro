import { describe, expect, it } from 'vitest';
import { readMemo, textMemo } from './memo.ts';
import { brlFor, hashQuote, quoteDomain, randomNonce } from './quote.ts';

describe('hashQuote', () => {
  // Same quote, same contract address and same digest as test_hashQuote_matchesViem in
  // contracts/test/RastroRFQ.t.sol. If either side changes the typed data, one of them fails.
  it('matches the digest pinned in the Foundry test', () => {
    const rfq = '0x1111111111111111111111111111111111111111';
    const digest = hashQuote(
      rfq,
      {
        payer: '0x2222222222222222222222222222222222222222',
        recipient: '0x3333333333333333333333333333333333333333',
        usdIn: 1_540_000_000n,
        brlOut: 8_182_410_000n,
        invoiceRef: textMemo('fatura-0047'),
        expiry: 1_791_000_000n,
        nonce: 47n,
      },
      42431,
    );
    expect(digest).toBe('0x19df3580515d64050eae38698a028ce959cea517d0d4a4452eaf3a4fd7764c61');
  });

  it('signs for Moderato by default', () => {
    expect(quoteDomain('0x1111111111111111111111111111111111111111').chainId).toBe(42431);
  });
});

describe('brlFor', () => {
  it('applies the rate and the spread', () => {
    // US$ 1,540.00 at 5.4123, less 0.50% = R$ 8,293.267290
    expect(brlFor(1_540_000_000n, '5.4123', 50)).toBe(8_293_267_290n);
  });

  it('rounds down to the base unit', () => {
    // 1 base unit of pathUSD at 5.40 less 0.50% is 5.373 base units of tBRL
    expect(brlFor(1n, '5.40', 50)).toBe(5n);
  });

  it('pays the full rate with no spread', () => {
    expect(brlFor(1_000_000n, '5.40', 0)).toBe(5_400_000n);
  });

  it('rejects a spread outside 0 to 9999 bps', () => {
    expect(() => brlFor(1n, '5.40', -1)).toThrow();
    expect(() => brlFor(1n, '5.40', 10_000)).toThrow();
    expect(() => brlFor(1n, '5.40', 12.5)).toThrow();
  });

  it('rejects a zero rate', () => {
    expect(() => brlFor(1n, '0', 50)).toThrow();
  });
});

describe('memo', () => {
  it('round-trips short ASCII text', () => {
    expect(readMemo(textMemo('fatura-0047'))).toBe('fatura-0047');
  });

  it('fits a 32-character Pix end-to-end ID exactly', () => {
    const id = 'E00000000202610101532ABCDEFGHIJK';
    expect(id).toHaveLength(32);
    expect(readMemo(textMemo(id))).toBe(id);
  });

  it('rejects text that does not fit or is not plain ASCII', () => {
    expect(() => textMemo('')).toThrow();
    expect(() => textMemo('x'.repeat(33))).toThrow();
    expect(() => textMemo('fatura nº 47')).toThrow();
  });
});

describe('randomNonce', () => {
  it('does not repeat', () => {
    expect(randomNonce()).not.toBe(randomNonce());
  });
});
