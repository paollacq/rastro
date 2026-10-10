import { describe, expect, it } from 'vitest';
import { decodeMemo, encodeMemo, endToEndFormat, isEndToEndId } from './e2e.ts';

// Official format, fake institution: 99999999 is not an ISPB anyone uses.
const official = 'E99999999202610081745SIMa1b2c3d4';
// What the PayZu sandbox returned on 2026-10-10.
const sandbox = ['E17916580821078hi6hh', 'E1791658094571pszbnm'];

describe('end-to-end ID', () => {
  it('accepts the 32-character official format', () => {
    expect(official).toHaveLength(32);
    expect(endToEndFormat(official)).toBe('official');
  });

  it.each(sandbox)('accepts the sandbox format %s', (id) => {
    expect(id).toHaveLength(20);
    expect(endToEndFormat(id)).toBe('sandbox');
  });

  it.each([
    ['too short', official.slice(0, 31)],
    ['too long', `${official}X`],
    ['a lowercase prefix', `e${official.slice(1)}`],
    ['a letter in the ISPB', `E9999999A${official.slice(9)}`],
    ['a sandbox ID with uppercase letters', 'E17916580821078HI6HH'],
    ['a sandbox ID one character short', 'E17916580821078hi6h'],
  ])('rejects %s', (_, value) => {
    expect(isEndToEndId(value)).toBe(false);
  });
});

describe('memo', () => {
  it.each([official, ...sandbox])('fits %s in one bytes32 and reads it back', (id) => {
    const memo = encodeMemo(id);
    expect(memo).toHaveLength(66);
    expect(decodeMemo(memo)).toBe(id);
  });

  it('pads short references and drops the padding on the way back', () => {
    expect(decodeMemo(encodeMemo('INV-0047'))).toBe('INV-0047');
  });

  it('refuses what would not fit', () => {
    expect(() => encodeMemo(`${official}!`)).toThrow();
    expect(() => encodeMemo('')).toThrow();
    expect(() => encodeMemo('fatura nº 47')).toThrow();
  });
});
