// The Etapa 1 finish line: a quote signed by the quoter, filled by the payer in one Tempo
// transaction, puts tBRL in Ana's wallet with the invoice reference as memo.
//
//   pnpm chain:fill-test                                US$ 12.34 at 5.40, memo "teste HH:MM:SS"
//   pnpm chain:fill-test --usd 1540 --ref fatura-0047   the demo invoice
import { parseArgs } from 'node:util';
import {
  BaseError,
  ContractFunctionRevertedError,
  encodeFunctionData,
  formatUnits,
  isAddressEqual,
  parseEventLogs,
  parseUnits,
  type Address,
} from 'viem';
import { generatePrivateKey, privateKeyToAddress } from 'viem/accounts';
import { Abis } from 'viem/tempo';
import { rastroRfqAbi } from './abi/rastroRfq.ts';
import { account } from './accounts.ts';
import { deployed, pathUsd } from './addresses.ts';
import { explorer, publicClient, walletClient } from './client.ts';
import { readMemo, textMemo } from './memo.ts';
import { brlFor, randomNonce, signQuote, type Quote } from './quote.ts';

const { values: opts } = parseArgs({
  options: {
    usd: { type: 'string', default: '12.34' },
    rate: { type: 'string', default: '5.40' },
    ref: { type: 'string', default: `teste ${new Date().toISOString().slice(11, 19)}` },
  },
});

const { tbrl, rfq } = deployed();
if (!tbrl || !rfq) throw new Error('No tBRL or RFQ address yet. Run pnpm chain:setup first.');

const payer = account('payer');
const quoter = account('quoter');
const ana = account('ana');
const client = publicClient();

const [usdDecimals, brlDecimals, treasury] = await Promise.all([
  client.readContract({ address: pathUsd, abi: Abis.tip20, functionName: 'decimals' }),
  client.readContract({ address: tbrl, abi: Abis.tip20, functionName: 'decimals' }),
  client.readContract({ address: rfq, abi: rastroRfqAbi, functionName: 'treasury' }),
]);
const usd = (amount: bigint) => `US$ ${formatUnits(amount, usdDecimals)}`;
const brl = (amount: bigint) => `R$ ${formatUnits(amount, brlDecimals)}`;
const names: [Address, string][] = [
  [payer.address, 'payer'],
  [treasury, 'treasury'],
  [rfq, 'RFQ'],
  [ana.address, 'Ana'],
];
const nameOf = (address: Address) => names.find(([known]) => isAddressEqual(known, address))?.[1] ?? address;

const usdIn = parseUnits(opts.usd, usdDecimals);
const brlOut = brlFor(usdIn, opts.rate, Number(process.env.SPREAD_BPS || 50));
const { timestamp } = await client.getBlock();
const quote: Quote = {
  payer: payer.address,
  recipient: ana.address,
  usdIn,
  brlOut,
  invoiceRef: textMemo(opts.ref),
  expiry: timestamp + 30n,
  nonce: randomNonce(),
};
console.log(`quote     ${usd(usdIn)} -> ${brl(brlOut)} for Ana, memo "${opts.ref}", valid for 30 s`);

// The usual mistakes, caught before paying a fee for them.
const [rfqQuoter, paused, payerBalance, stock] = await Promise.all([
  client.readContract({ address: rfq, abi: rastroRfqAbi, functionName: 'quoter' }),
  client.readContract({ address: rfq, abi: rastroRfqAbi, functionName: 'paused' }),
  client.readContract({ address: pathUsd, abi: Abis.tip20, functionName: 'balanceOf', args: [payer.address] }),
  client.readContract({ address: tbrl, abi: Abis.tip20, functionName: 'balanceOf', args: [rfq] }),
]);
if (!isAddressEqual(rfqQuoter, quoter.address)) {
  throw new Error(`The RFQ trusts quoter ${rfqQuoter}, but QUOTER_PRIVATE_KEY is ${quoter.address}.`);
}
if (paused) throw new Error('The RFQ is paused.');
if (payerBalance < usdIn) throw new Error(`The payer has ${usd(payerBalance)}. Run pnpm wallets:fund.`);
if (stock < brlOut) throw new Error(`The RFQ holds ${brl(stock)}. Run pnpm chain:setup to restock it.`);

// The policy both ways, read-only: the same tBRL transfer out of the RFQ goes through to Ana
// and is refused to a wallet nobody approved.
const tryTransfer = (to: Address) =>
  client
    .simulateContract({
      account: rfq,
      address: tbrl,
      abi: Abis.tip20,
      functionName: 'transferWithMemo',
      args: [to, 1n, quote.invoiceRef],
    })
    .then(
      () => 'goes through',
      (error: unknown) => `refused (${reason(error)})`,
    );
const stranger = privateKeyToAddress(generatePrivateKey());
console.log(`policy    to Ana: ${await tryTransfer(ana.address)}; to an unknown wallet: ${await tryTransfer(stranger)}`);

// Approve and fill in one Tempo transaction, one signature.
const signature = await signQuote(quoter, rfq, quote);
const receipt = await walletClient(payer).sendTransactionSync({
  calls: [
    {
      to: pathUsd,
      data: encodeFunctionData({ abi: Abis.tip20, functionName: 'approve', args: [rfq, usdIn] }),
    },
    {
      to: rfq,
      data: encodeFunctionData({ abi: rastroRfqAbi, functionName: 'fill', args: [quote, signature] }),
    },
  ],
});
const txLink = `${explorer}/tx/${receipt.transactionHash}`;
if (receipt.status !== 'success') throw new Error(`The fill reverted: ${txLink}`);

// Read both legs back from the receipt.
const legs = parseEventLogs({ abi: Abis.tip20, logs: receipt.logs, eventName: 'TransferWithMemo' });
for (const { address, args } of legs) {
  const isBrl = isAddressEqual(address, tbrl);
  const amount = formatUnits(args.amount, isBrl ? brlDecimals : usdDecimals);
  console.log(
    `leg       ${(isBrl ? 'tBRL' : 'pathUSD').padEnd(8)}${amount.padStart(10)}  ` +
      `${nameOf(args.from)} -> ${nameOf(args.to)}  memo "${readMemo(args.memo)}"`,
  );
}

const payment = legs.find((leg) => isAddressEqual(leg.address, pathUsd) && isAddressEqual(leg.args.to, treasury));
const payout = legs.find((leg) => isAddressEqual(leg.address, tbrl) && isAddressEqual(leg.args.to, ana.address));
const ok =
  payment?.args.amount === usdIn &&
  payment.args.memo === quote.invoiceRef &&
  payout?.args.amount === brlOut &&
  payout.args.memo === quote.invoiceRef;

console.log(`
${ok ? 'OK: Ana got the tBRL and both legs carry the invoice memo.' : 'Something is off: compare the legs above with the quote.'}
tx         ${txLink}
Ana        ${explorer}/address/${ana.address}`);
if (!ok) process.exitCode = 1;

function reason(error: unknown) {
  if (!(error instanceof BaseError)) return String(error);
  const revert = error.walk((cause) => cause instanceof ContractFunctionRevertedError);
  if (revert instanceof ContractFunctionRevertedError) {
    return revert.data?.errorName ?? revert.signature ?? revert.shortMessage;
  }
  return error.shortMessage;
}
