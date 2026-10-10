import { readFileSync, writeFileSync } from 'node:fs';
import { getAddress, type Address, type Hash } from 'viem';

// What `pnpm chain:setup` created on Moderato. The file is committed, so the whole team and
// the deployed app read the same addresses. Node only; the app reads it through addresses.ts.
export type Deployment = {
  chainId: number;
  policyId: string | null;
  tbrl: Address | null;
  rfq: Address | null;
  txs: Record<string, Hash>;
};

export const deploymentFile = new URL('../deployments/moderato.json', import.meta.url);

export function loadDeployment(chainId: number): Deployment {
  const data = JSON.parse(readFileSync(deploymentFile, 'utf8')) as Partial<Deployment>;
  if (data.chainId !== chainId) {
    throw new Error(`deployments/moderato.json is for chain ${data.chainId}, not ${chainId}`);
  }
  return {
    chainId,
    policyId: data.policyId ?? null,
    tbrl: data.tbrl ? getAddress(data.tbrl) : null,
    rfq: data.rfq ? getAddress(data.rfq) : null,
    txs: data.txs ?? {},
  };
}

export function saveDeployment(data: Deployment) {
  writeFileSync(deploymentFile, `${JSON.stringify(data, null, 2)}\n`);
}
