import { chain, publicClient } from '@rastro/chain';

// For now this only proves the worker reaches Moderato from wherever it runs.
// The event watcher and the reserve check come next.
const client = publicClient();

async function tick() {
  const block = await client.getBlockNumber();
  console.log(`${new Date().toISOString()} ${chain.name} block ${block}`);
}

await tick();
setInterval(() => tick().catch((err: Error) => console.error(err.message)), 15_000);
