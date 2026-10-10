import { fromCents, toCents } from '@rastro/pix';
import { randomBytes } from 'node:crypto';

// tBRL and pathUSD have 6 decimals; Pix moves centavos. One centavo is 10^4 base units.
export const BASE_PER_CENT = 10_000n;

export const floorToCents = (base: bigint) => base - (base % BASE_PER_CENT);

export const brlToBase = (amountBrl: string) => toCents(amountBrl) * BASE_PER_CENT;

export function baseToBrl(base: bigint): string {
  if (base % BASE_PER_CENT !== 0n) throw new Error(`${base} base units is not a whole number of centavos`);
  return fromCents(base / BASE_PER_CENT);
}

const ALPHABET = 'abcdefghijklmnopqrstuvwxyz0123456789';

// Short, lowercase, unambiguous enough to read aloud in the demo: saque-k3j9x2m1.
export function newId(prefix: string, length = 8) {
  let out = '';
  while (out.length < length) {
    for (const byte of randomBytes(length * 2)) {
      if (byte < 252 && out.length < length) out += ALPHABET[byte % 36];
    }
  }
  return `${prefix}-${out}`;
}
