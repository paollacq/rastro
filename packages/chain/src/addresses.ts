import { getAddress, type Address } from 'viem';
import { Addresses } from 'viem/tempo';

// Precompiles. Same address on every Tempo network.
export const pathUsd = Addresses.pathUsd;
export const tip20Factory = Addresses.tip20Factory;
export const tip403Registry = Addresses.tip403Registry;

// Ours, read from .env once they exist on Moderato.
export function deployed() {
  return {
    tbrl: toAddress(process.env.TBRL_ADDRESS),
    rfq: toAddress(process.env.RFQ_ADDRESS),
    policyId: process.env.POLICY_ID ? BigInt(process.env.POLICY_ID) : undefined,
  };
}

function toAddress(value: string | undefined): Address | undefined {
  return value ? getAddress(value) : undefined;
}
