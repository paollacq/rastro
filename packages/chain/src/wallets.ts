import { generatePrivateKey, privateKeyToAccount } from 'viem/accounts';
import { account, envName, roles } from './accounts.ts';
import { explorer, publicClient } from './client.ts';

const command = process.argv[2];

if (command === 'new') {
  for (const role of roles) {
    const key = generatePrivateKey();
    console.log(`# ${role}: ${privateKeyToAccount(key).address}`);
    console.log(`${envName(role)}=${key}`);
  }
  console.log('\n# Testnet only. Paste into .env (git ignores it).');
} else if (command === 'fund') {
  const client = publicClient();
  for (const role of roles) {
    const { address } = account(role);
    const receipts = await client.faucet.fundSync({ account: address });
    console.log(`${role.padEnd(9)}${address}  ${receipts.length} faucet transfers`);
  }
  console.log(`\n${explorer}`);
} else {
  console.error('usage: tsx src/wallets.ts new|fund');
  process.exitCode = 1;
}
