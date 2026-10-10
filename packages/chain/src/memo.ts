import { hexToString, stringToHex, type Hex } from 'viem';

// A TIP-20 memo is 32 bytes. Rastro writes short ASCII text into it (an invoice reference
// now, the Pix end-to-end ID later), zero-padded on the right, so it reads back as text.
export function textMemo(text: string): Hex {
  if (!/^[\x20-\x7e]{1,32}$/.test(text)) {
    throw new Error(`memo must be 1 to 32 printable ASCII characters, got "${text}"`);
  }
  return stringToHex(text, { size: 32 });
}

export function readMemo(memo: Hex): string {
  return hexToString(memo, { size: 32 }).replace(/\0+$/, '');
}
