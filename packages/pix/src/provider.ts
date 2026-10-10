// What the rest of Rastro needs from a Pix provider. The PayZu sandbox and our own
// simulator both implement it, and PIX_MODE picks one.

export type PixStatus = 'PENDING' | 'COMPLETED' | 'FAILED';

export interface PixTransfer {
  id: string; // the provider's id
  reference: string; // ours, sent as clientReference
  status: PixStatus;
  providerStatus: string; // as the provider wrote it, for the trail page
  amountBrl: string; // "8274.42"
  endToEndId: string | null;
}

export interface PixProvider {
  readonly name: 'payzu-sandbox' | 'simulator';
  createCharge(input: { amountBrl: string; reference: string }): Promise<PixTransfer>;
  createWithdrawal(input: {
    amountBrl: string;
    pixKey: string;
    pixKeyType: string;
    reference: string;
  }): Promise<PixTransfer>;
  // null when nothing was ever created under this reference
  findWithdrawal(reference: string): Promise<PixTransfer | null>;
  balance(): Promise<{ availableBrl: string }>;
}

// PayZu statuses: PENDING, COMPLETED, CANCELED, WAITING_FOR_REFUND, REFUNDED, EXPIRED, ERROR.
export function toPixStatus(providerStatus: string): PixStatus {
  if (providerStatus === 'PENDING') return 'PENDING';
  if (providerStatus === 'COMPLETED') return 'COMPLETED';
  return 'FAILED';
}

// "8274.42" -> 827442n. Pix moves whole centavos only.
export function toCents(amountBrl: string): bigint {
  const match = /^(\d+)(?:\.(\d{1,2}))?$/.exec(amountBrl);
  if (!match) throw new Error(`not a BRL amount with up to 2 decimals: "${amountBrl}"`);
  return BigInt(match[1]) * 100n + BigInt((match[2] ?? '').padEnd(2, '0'));
}

export function fromCents(cents: bigint): string {
  const sign = cents < 0n ? '-' : '';
  const abs = cents < 0n ? -cents : cents;
  return `${sign}${abs / 100n}.${(abs % 100n).toString().padStart(2, '0')}`;
}
