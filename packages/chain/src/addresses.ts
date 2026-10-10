import { getAddress, type Address } from 'viem';
import { Addresses } from 'viem/tempo';
import saved from '../deployments/moderato.json' with { type: 'json' };

// Precompiles. Same address on every Tempo network.
export const pathUsd = Addresses.pathUsd;
export const tip20Factory = Addresses.tip20Factory;
export const tip403Registry = Addresses.tip403Registry;

// Ours, exactly as `pnpm chain:setup` wrote them. One source of truth for the scripts and the
// app; to point at another deployment, edit or replace deployments/moderato.json.
export function deployed() {
  const file = saved as { policyId: string | null; tbrl: string | null; rfq: string | null };
  return {
    tbrl: toAddress(file.tbrl),
    rfq: toAddress(file.rfq),
    policyId: file.policyId ? BigInt(file.policyId) : undefined,
  };
}

function toAddress(value: string | null): Address | undefined {
  return value ? getAddress(value) : undefined;
}
