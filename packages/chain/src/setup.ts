// Etapa 1 on Moderato: tBRL behind a whitelist, the RFQ deployed and stocked.
//
// Safe to run again. Each step looks at the chain first and skips what is already done, and
// whatever it creates goes into deployments/moderato.json the moment it exists.
import { PayZu } from '@rastro/pix';
import { formatUnits, isAddressEqual, keccak256, parseUnits, toHex, type Address, type Hash } from 'viem';
import { Abis } from 'viem/tempo';
import { rastroRfqAbi, rastroRfqBytecode } from './abi/rastroRfq.ts';
import { account } from './accounts.ts';
import { pathUsd, tip20Factory } from './addresses.ts';
import { chain, explorer, publicClient, walletClient } from './client.ts';
import { loadDeployment, saveDeployment } from './deployments.ts';
import { textMemo } from './memo.ts';

const token = { name: 'Real Rastro (teste)', symbol: 'tBRL', currency: 'BRL' } as const;
// The PayZu sandbox starts with R$ 10.000,00 and the RFQ's stock mirrors it.
const inventory = process.env.RFQ_INVENTORY_BRL || '10000';

const admin = account('admin');
const treasury = account('treasury');
const quoter = account('quoter');
const ana = account('ana');

const client = publicClient();
const asAdmin = walletClient(admin);
const asTreasury = walletClient(treasury);

const link = (hash: Hash) => `${explorer}/tx/${hash}`;
const say = (step: string, text: string) => console.log(`${step.padEnd(11)}${text}`);
const wrongKeys = (what: string, owner: Address) =>
  new Error(
    `deployments/moderato.json points to a ${what} run by ${owner}, but ADMIN_PRIVATE_KEY is ${admin.address}. ` +
      'Use the .env from the first setup, or restore the empty deployments file to start over.',
  );

const chainId = await client.getChainId();
if (chainId !== chain.id) throw new Error(`RPC answered chain ${chainId}, expected ${chain.id}`);

// Every transaction below pays its fee in pathUSD.
for (const [role, who] of [
  ['admin', admin],
  ['treasury', treasury],
] as const) {
  const balance = await client.readContract({
    address: pathUsd,
    abi: Abis.tip20,
    functionName: 'balanceOf',
    args: [who.address],
  });
  if (balance === 0n) throw new Error(`${role} ${who.address} has no pathUSD for fees. Run pnpm wallets:fund.`);
}

const state = loadDeployment(chain.id);
const record = (key: string, hash: Hash) => {
  state.txs[key] = hash;
  saveDeployment(state);
};

// 1. Whitelist policy. Treasury and Ana go in now; the RFQ joins once it exists.
if (!state.policyId) {
  const { policyId, receipt } = await asAdmin.policy.createSync({
    type: 'whitelist',
    addresses: [treasury.address, ana.address],
  });
  state.policyId = policyId.toString();
  record('policy', receipt.transactionHash);
  say('policy', `#${policyId} created  ${link(receipt.transactionHash)}`);
} else {
  const { admin: owner } = await client.policy.getData({ policyId: BigInt(state.policyId) });
  if (!isAddressEqual(owner, admin.address)) throw wrongKeys('policy', owner);
  say('policy', `#${state.policyId} already there`);
}
const policyId = BigInt(state.policyId);

// 2. tBRL. The currency is fixed at creation; the policy isn't, so the token starts on policy 1.
// A fixed salt gives the token a predictable address: if an earlier run created it but died
// before saving, this run finds it instead of making a second tBRL. New label, new token.
if (!state.tbrl) {
  const salt = keccak256(toHex('rastro:tBRL:1'));
  const predicted = await client.readContract({
    address: tip20Factory,
    abi: Abis.tip20Factory,
    functionName: 'getTokenAddress',
    args: [admin.address, salt],
  });
  if (await client.readContract({ address: tip20Factory, abi: Abis.tip20Factory, functionName: 'isTIP20', args: [predicted] })) {
    state.tbrl = predicted;
    saveDeployment(state);
    say('tBRL', `${predicted} found, created by an earlier run`);
  } else {
    const created = await asAdmin.token.createSync({ ...token, quoteToken: pathUsd, salt });
    state.tbrl = created.token;
    record('token', created.receipt.transactionHash);
    say('tBRL', `${created.token} created  ${link(created.receipt.transactionHash)}`);
  }
} else {
  say('tBRL', `${state.tbrl} already there`);
}
const tbrl = state.tbrl;
if (!(await client.token.hasRole({ token: tbrl, account: admin.address, role: 'defaultAdmin' }))) {
  throw new Error(
    `ADMIN_PRIVATE_KEY (${admin.address}) is not an admin of tBRL ${tbrl}. ` +
      'Use the .env from the first setup, or restore the empty deployments file to start over.',
  );
}

// 3. Put tBRL under the whitelist.
const currentPolicy = await client.readContract({ address: tbrl, abi: Abis.tip20, functionName: 'transferPolicyId' });
if (currentPolicy !== policyId) {
  const { receipt } = await asAdmin.token.changeTransferPolicySync({ token: tbrl, policyId });
  record('tokenPolicy', receipt.transactionHash);
  say('link', `tBRL now follows policy #${policyId}  ${link(receipt.transactionHash)}`);
} else {
  say('link', `tBRL already follows policy #${policyId}`);
}

// 4. Roles: the treasury mints and burns, the admin can pause and unpause.
const grants = [
  ['issuer', treasury.address, 'treasury'],
  ['pause', admin.address, 'admin'],
  ['unpause', admin.address, 'admin'],
] as const;
for (const [role, to, who] of grants) {
  if (await client.token.hasRole({ token: tbrl, account: to, role })) {
    say('role', `${role} -> ${who} already granted`);
    continue;
  }
  const { receipt } = await asAdmin.token.grantRolesSync({ token: tbrl, roles: [role], to });
  record(`role:${role}`, receipt.transactionHash);
  say('role', `${role} -> ${who}  ${link(receipt.transactionHash)}`);
}

// 5. The RFQ. The deploy hash is saved before waiting, so a dropped connection doesn't lead
// to a second contract on the next run.
if (!state.rfq) {
  let hash = state.txs.rfq;
  if (!hash) {
    hash = await asAdmin.deployContract({
      abi: rastroRfqAbi,
      bytecode: rastroRfqBytecode,
      args: [admin.address, quoter.address, treasury.address, pathUsd, tbrl],
    });
    record('rfq', hash);
  }
  const receipt = await client.waitForTransactionReceipt({ hash, timeout: 60_000 }).catch(() => {
    throw new Error(
      `No receipt for the RFQ deploy ${link(hash)}. If the explorer doesn't know it either, ` +
        'delete txs.rfq from deployments/moderato.json and run again.',
    );
  });
  if (receipt.status !== 'success' || !receipt.contractAddress) {
    delete state.txs.rfq;
    saveDeployment(state);
    throw new Error(`The RFQ deploy reverted: ${link(hash)}. Running setup again retries it.`);
  }
  state.rfq = receipt.contractAddress;
  saveDeployment(state);
  say('RFQ', `${state.rfq} deployed  ${link(hash)}`);
} else {
  say('RFQ', `${state.rfq} already there`);
}
const rfq = state.rfq;

const [rfqAdmin, rfqBrl, rfqQuoter, rfqTreasury] = await Promise.all(
  (['admin', 'brl', 'quoter', 'treasury'] as const).map((functionName) =>
    client.readContract({ address: rfq, abi: rastroRfqAbi, functionName }),
  ),
);
if (!isAddressEqual(rfqAdmin, admin.address)) throw wrongKeys('RFQ', rfqAdmin);
if (!isAddressEqual(rfqBrl, tbrl)) {
  throw new Error(
    `The RFQ at ${rfq} pays out ${rfqBrl}, not tBRL ${tbrl}. ` +
      'Clear rfq and txs.rfq in deployments/moderato.json to deploy one for this token.',
  );
}
// Quoter and treasury keys can be rotated without a new deploy.
for (const [functionName, current, wanted] of [
  ['setQuoter', rfqQuoter, quoter.address],
  ['setTreasury', rfqTreasury, treasury.address],
] as const) {
  if (isAddressEqual(current, wanted)) continue;
  const receipt = await asAdmin.writeContractSync({ address: rfq, abi: rastroRfqAbi, functionName, args: [wanted] });
  record(functionName, receipt.transactionHash);
  say('RFQ', `${functionName}(${wanted})  ${link(receipt.transactionHash)}`);
}

// 6. Whitelist. TIP-403 checks sender and recipient, so the RFQ has to be on it too.
const members = [
  ['treasury', treasury.address],
  ['RFQ', rfq],
  ['Ana', ana.address],
] as const;
for (const [who, address] of members) {
  if (await client.policy.isAuthorized({ policyId, user: address })) {
    say('whitelist', `${who} already on`);
    continue;
  }
  const { receipt } = await asAdmin.policy.modifyWhitelistSync({ policyId, address, allowed: true });
  record(`whitelist:${who}`, receipt.transactionHash);
  say('whitelist', `${who} added  ${link(receipt.transactionHash)}`);
}

// 7. Stock: the treasury mints tBRL straight into the RFQ, up to the target, and never past
// the reais behind it. With Pix on the PayZu sandbox, that is the sandbox balance: total
// tBRL supply may not exceed it.
const decimals = await client.readContract({ address: tbrl, abi: Abis.tip20, functionName: 'decimals' });
const target = parseUnits(inventory, decimals);
const stock = await client.readContract({ address: tbrl, abi: Abis.tip20, functionName: 'balanceOf', args: [rfq] });
let toMint = stock < target ? target - stock : 0n;

const reserve = await sandboxReserve(decimals);
if (reserve === 'unknown') {
  say('reserve', "couldn't read the PayZu sandbox balance, so nothing is minted. Fix PAYZU_TOKEN (or set PIX_MODE=simulator) and run setup again.");
  toMint = 0n;
} else if (reserve !== null && toMint > 0n) {
  const supply = await client.readContract({ address: tbrl, abi: Abis.tip20, functionName: 'totalSupply' });
  const headroom = reserve > supply ? reserve - supply : 0n;
  if (toMint > headroom) {
    say('reserve', `the sandbox holds R$ ${formatUnits(reserve, decimals)}; minting only what that backs`);
    toMint = headroom;
  }
}

if (toMint > 0n) {
  const { receipt } = await asTreasury.token.mintSync({
    token: tbrl,
    to: rfq,
    amount: toMint,
    memo: textMemo('rastro:inventory'),
  });
  record('inventory', receipt.transactionHash);
  say('inventory', `${formatUnits(toMint, decimals)} tBRL minted to the RFQ  ${link(receipt.transactionHash)}`);
} else {
  say('inventory', `the RFQ holds ${formatUnits(stock, decimals)} tBRL; nothing to mint`);
}

// The PayZu sandbox balance in token units; null when Pix runs on the simulator (which
// starts with the same R$ 10.000 as the target); 'unknown' when the sandbox can't be read,
// in which case nothing is minted: no tBRL without the reais behind it.
async function sandboxReserve(tokenDecimals: number): Promise<bigint | null | 'unknown'> {
  if (process.env.PIX_MODE === 'simulator') return null;
  if (!process.env.PAYZU_TOKEN) return 'unknown';
  try {
    const { balanceAvailable } = await PayZu.fromEnv().balance();
    return parseUnits(balanceAvailable.toFixed(2), tokenDecimals);
  } catch (error) {
    say('reserve', `PayZu: ${error instanceof Error ? error.message.slice(0, 100) : error}`);
    return 'unknown';
  }
}

console.log(`
policy     #${policyId}
tBRL       ${tbrl}
RFQ        ${rfq}

Commit packages/chain/deployments/moderato.json so the team and the app use these addresses.
Next: pnpm chain:fill-test`);
