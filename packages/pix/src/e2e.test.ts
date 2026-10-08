import { describe, expect, it } from 'vitest';
import { decodeMemo, encodeMemo, isEndToEndId } from './e2e.ts';

// Real format, fake institution: 99999999 is not an ISPB anyone uses.
const id = 'E99999999202610081745SIMa1b2c3d4';

describe('end-to-end ID', () => {
  it('accepts the 32-character format', () => {
    expect(id).toHaveLength(32);
    expect(isEndToEndId(id)).toBe(true);
  });

  it.each([
    ['too short', id.slice(0, 31)],
    ['too long', `${id}X`],
    ['a lowercase prefix', `e${id.slice(1)}`],
    ['a letter in the ISPB', `E9999999A${id.slice(9)}`],
  ])('rejects %s', (_, value) => {
    expect(isEndToEndId(value)).toBe(false);
  });
});

describe('memo', () => {
  it('fits the whole ID in one bytes32 and reads it back', () => {
    const memo = encodeMemo(id);
    expect(memo).toHaveLength(66);
    expect(decodeMemo(memo)).toBe(id);
  });

  it('pads short references and drops the padding on the way back', () => {
    expect(decodeMemo(encodeMemo('INV-0047'))).toBe('INV-0047');
  });

  it('refuses what would not fit', () => {
    expect(() => encodeMemo(`${id}!`)).toThrow();
    expect(() => encodeMemo('')).toThrow();
    expect(() => encodeMemo('fatura nº 47')).toThrow();
  });
});
