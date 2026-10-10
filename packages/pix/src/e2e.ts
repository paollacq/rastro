import { hexToString, stringToHex, type Hex } from 'viem';

// A Pix end-to-end ID as the Central Bank defines it: "E", the 8-digit ISPB of the
// institution, yyyyMMddHHmm and 11 alphanumeric characters. 32 characters, so it fills
// a TIP-20 memo (bytes32) exactly.
export const END_TO_END_ID = /^E\d{8}\d{12}[A-Za-z0-9]{11}$/;

// The PayZu sandbox doesn't issue IDs in that format. Its IDs are "E", a 10-digit unix
// timestamp and 9 lowercase alphanumerics: 20 characters, e.g. E17916580821078hi6hh
// (first seen on 2026-10-10). They still fit the memo, with room to spare.
export const SANDBOX_END_TO_END_ID = /^E\d{10}[a-z0-9]{9}$/;

export type EndToEndFormat = 'official' | 'sandbox';

export function endToEndFormat(value: string): EndToEndFormat | null {
  if (END_TO_END_ID.test(value)) return 'official';
  if (SANDBOX_END_TO_END_ID.test(value)) return 'sandbox';
  return null;
}

export const isEndToEndId = (value: string) => endToEndFormat(value) !== null;

// Raw IDs on testnet only. On mainnet the memo should carry a salted hash.
export function encodeMemo(text: string): Hex {
  if (!/^[\x20-\x7e]{1,32}$/.test(text)) {
    throw new Error(`memo must be 1 to 32 printable ASCII characters, got "${text}"`);
  }
  return stringToHex(text, { size: 32 });
}

export function decodeMemo(memo: Hex): string {
  return hexToString(memo, { size: 32 }).replace(/\0+$/, '');
}
