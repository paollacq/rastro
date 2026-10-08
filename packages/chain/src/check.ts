import { formatUnits } from 'viem';
import { Abis } from 'viem/tempo';
import { maybeAccount, roles } from './accounts.ts';
import { pathUsd, tip20Factory, tip403Registry } from './addresses.ts';
import { chain, explorer, publicClient } from './client.ts';

const client = publicClient();

const [chainId, block] = await Promise.all([client.getChainId(), client.getBlockNumber()]);
if (chainId !== chain.id) throw new Error(`RPC answered chain ${chainId}, expected ${chain.id}`);
console.log(`${chain.name}, block ${block}`);

const [factoryKnowsPathUsd, policies, decimals] = await Promise.all([
  client.readContract({ address: tip20Factory, abi: Abis.tip20Factory, functionName: 'isTIP20', args: [pathUsd] }),
  client.readContract({ address: tip403Registry, abi: Abis.tip403Registry, functionName: 'policyIdCounter' }),
  client.readContract({ address: pathUsd, abi: Abis.tip20, functionName: 'decimals' }),
]);
console.log(`TIP-20 factory recognizes pathUSD: ${factoryKnowsPathUsd}`);
console.log(`TIP-403 policies on the network: ${policies}\n`);

for (const role of roles) {
  const address = maybeAccount(role)?.address;
  if (!address) {
    console.log(`${role.padEnd(9)}not in .env`);
    continue;
  }
  const balance = await client.readContract({
    address: pathUsd,
    abi: Abis.tip20,
    functionName: 'balanceOf',
    args: [address],
  });
  console.log(`${role.padEnd(9)}${address}  ${formatUnits(balance, decimals)} pathUSD`);
}

console.log(`\n${explorer}`);
