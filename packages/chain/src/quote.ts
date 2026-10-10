import { bytesToBigInt, hashTypedData, parseUnits, type Address, type Hex, type LocalAccount } from 'viem';
import { chain } from './client.ts';

// A quote as RastroRFQ sees it. Amounts are base units; pathUSD and tBRL both have 6 decimals.
export type Quote = {
  payer: Address;
  recipient: Address;
  usdIn: bigint;
  brlOut: bigint;
  invoiceRef: Hex;
  expiry: bigint;
  nonce: bigint;
};

// Field names, order and types must match QUOTE_TYPEHASH in contracts/src/RastroRFQ.sol.
// test_hashQuote_matchesViem and quote.test.ts pin the same digest on both sides.
export const quoteTypes = {
  Quote: [
    { name: 'payer', type: 'address' },
    { name: 'recipient', type: 'address' },
    { name: 'usdIn', type: 'uint256' },
    { name: 'brlOut', type: 'uint256' },
    { name: 'invoiceRef', type: 'bytes32' },
    { name: 'expiry', type: 'uint64' },
    { name: 'nonce', type: 'uint256' },
  ],
} as const;

export const quoteDomain = (rfq: Address, chainId: number = chain.id) =>
  ({ name: 'RastroRFQ', version: '1', chainId, verifyingContract: rfq }) as const;

export const hashQuote = (rfq: Address, quote: Quote, chainId?: number) =>
  hashTypedData({ domain: quoteDomain(rfq, chainId), types: quoteTypes, primaryType: 'Quote', message: quote });

export const signQuote = (quoter: LocalAccount, rfq: Address, quote: Quote) =>
  quoter.signTypedData({ domain: quoteDomain(rfq), types: quoteTypes, primaryType: 'Quote', message: quote });

export const randomNonce = () => bytesToBigInt(globalThis.crypto.getRandomValues(new Uint8Array(32)));

// Reais owed for `usdIn` at `brlPerUsd` (a decimal string such as PTAX "5.4123"), less the
// spread in basis points. Rounds down: the treasury never pays a fraction it didn't charge for.
export function brlFor(usdIn: bigint, brlPerUsd: string, spreadBps: number): bigint {
  if (!Number.isInteger(spreadBps) || spreadBps < 0 || spreadBps >= 10_000) {
    throw new Error(`spread must be a whole number of bps from 0 to 9999, got ${spreadBps}`);
  }
  const rate = parseUnits(brlPerUsd, 8);
  if (rate <= 0n) throw new Error(`rate must be positive, got ${brlPerUsd}`);
  return (usdIn * rate * BigInt(10_000 - spreadBps)) / (10n ** 8n * 10_000n);
}
