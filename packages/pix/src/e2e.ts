import { hexToString, stringToHex, type Hex } from 'viem';

// Pix end-to-end ID: "E", the 8-digit ISPB of the institution, yyyyMMddHHmm and
// 11 alphanumeric characters. 32 ASCII characters, so it fits a TIP-20 memo
// (bytes32) without hashing or truncating.
export const END_TO_END_ID = /^E\d{8}\d{12}[A-Za-z0-9]{11}$/;

export const isEndToEndId = (value: string) => END_TO_END_ID.test(value);

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
