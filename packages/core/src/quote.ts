import { brlFor, chain, randomNonce, rastroRfqAbi, signQuote, textMemo, type Quote } from '@rastro/chain';
import { encodeFunctionData, getAddress, isAddressEqual, parseUnits, type Hash, type Hex } from 'viem';
import { Abis } from 'viem/tempo';
import type { Context } from './context.ts';
import { AppError, notFound } from './errors.ts';
import { floorToCents, newId } from './money.ts';
import { latestPtax, type Ptax } from './ptax.ts';

export const QUOTE_SECONDS = 30;

// What the payer's screen gets back. Big numbers travel as strings.
export interface QuoteOffer {
  id: string;
  invoiceId: string;
  rfq: string;
  chainId: number;
  quote: { payer: string; recipient: string; usdIn: string; brlOut: string; invoiceRef: Hex; expiry: string; nonce: string };
  signature: Hex;
  ptax: Ptax;
  spreadBps: number;
  expiresAt: string;
}

// brlOut = usdIn × PTAX × (1 − spread), rounded down to the centavo, because the Pix at
// the other end can only move whole centavos.
export async function createQuote(ctx: Context, invoiceId: string): Promise<QuoteOffer> {
  const invoice = await ctx.db.invoice(invoiceId);
  if (!invoice) throw notFound('fatura');
  if (invoice.status === 'paga') throw new AppError(409, 'esta fatura já foi paga');
  const recipient = await ctx.db.user(invoice.recipientId);
  if (!recipient) throw notFound('recebedora');

  const ptax = await latestPtax({
    now: ctx.now(),
    fallback: async () => {
      const last = await ctx.db.lastPtax();
      return last ? { rate: last.ptaxRate, date: last.ptaxDate } : null;
    },
  });

  const usdIn = parseUnits(invoice.amountUsd, 6);
  const brlOut = floorToCents(brlFor(usdIn, ptax.rate, ctx.spreadBps));
  const expiry = BigInt(Math.floor(ctx.now().getTime() / 1000) + QUOTE_SECONDS);
  const quote: Quote = {
    payer: getAddress(invoice.payerWallet),
    recipient: getAddress(recipient.wallet),
    usdIn,
    brlOut,
    invoiceRef: textMemo(invoice.id),
    expiry,
    nonce: randomNonce(),
  };
  const signature = await signQuote(ctx.signer('quoter').account, ctx.addresses.rfq, quote);

  const id = newId('cot', 10);
  await ctx.db.insertQuote({
    id,
    invoiceId,
    payer: quote.payer,
    recipient: quote.recipient,
    ptaxDate: ptax.date,
    ptaxRate: ptax.rate,
    spreadBps: ctx.spreadBps,
    usdIn: usdIn.toString(),
    brlOut: brlOut.toString(),
    invoiceRef: invoice.id,
    nonce: quote.nonce.toString(),
    expiry: new Date(Number(expiry) * 1000),
    signature,
  });

  return {
    id,
    invoiceId,
    rfq: ctx.addresses.rfq,
    chainId: chain.id,
    quote: {
      payer: quote.payer,
      recipient: quote.recipient,
      usdIn: usdIn.toString(),
      brlOut: brlOut.toString(),
      invoiceRef: quote.invoiceRef,
      expiry: expiry.toString(),
      nonce: quote.nonce.toString(),
    },
    signature,
    ptax,
    spreadBps: ctx.spreadBps,
    expiresAt: new Date(Number(expiry) * 1000).toISOString(),
  };
}

// The demo payer pays from a server-held test key, since the passkey was cut.
// On Tempo the approve and the fill go in one transaction with one signature.
export async function payQuote(ctx: Context, quoteId: string): Promise<{ txHash: Hash; alreadyPaid: boolean }> {
  const row = await ctx.db.quote(quoteId);
  if (!row) throw notFound('cotação');
  if (row.fillTx) return { txHash: row.fillTx as Hash, alreadyPaid: true };
  if ((await ctx.db.invoice(row.invoiceId))?.status === 'paga') throw new AppError(409, 'esta fatura já foi paga');
  if (row.expiry.getTime() <= ctx.now().getTime()) throw new AppError(409, 'a cotação venceu; peça outra');

  const payer = ctx.signer('payer');
  if (!isAddressEqual(payer.account.address, row.payer as Hex)) {
    throw new AppError(403, 'esta demo só paga com a carteira de PAYER_PRIVATE_KEY');
  }

  // One payment per invoice at a time: a double click gets a 409, not a second fill.
  if (!(await ctx.db.claimInvoice(row.invoiceId, quoteId))) {
    throw new AppError(409, 'já tem um pagamento desta fatura em andamento');
  }
  try {
    const txHash = await fill(ctx, row);
    await ctx.db.setQuoteFill(quoteId, txHash);
    await ctx.db.markInvoicePaid(row.invoiceId);
    return { txHash, alreadyPaid: false };
  } catch (error) {
    await ctx.db.releaseInvoice(row.invoiceId, quoteId);
    throw error;
  }
}

async function fill(ctx: Context, row: NonNullable<Awaited<ReturnType<Context['db']['quote']>>>): Promise<Hash> {
  const quote: Quote = {
    payer: getAddress(row.payer),
    recipient: getAddress(row.recipient),
    usdIn: BigInt(row.usdIn),
    brlOut: BigInt(row.brlOut),
    invoiceRef: textMemo(row.invoiceRef),
    expiry: BigInt(Math.floor(row.expiry.getTime() / 1000)),
    nonce: BigInt(row.nonce),
  };
  const { rfq } = ctx.addresses;
  // A quote already used on-chain (a retry after a lost answer) is not sent again.
  if (await ctx.client.readContract({ address: rfq, abi: rastroRfqAbi, functionName: 'nonceUsed', args: [quote.nonce] })) {
    throw new AppError(409, 'esta cotação já foi usada');
  }
  // Approve the token the RFQ actually pulls (pathUSD on Tempo), read from the contract itself.
  const usd = await ctx.client.readContract({ address: rfq, abi: rastroRfqAbi, functionName: 'usd' });
  const approve = encodeFunctionData({ abi: Abis.tip20, functionName: 'approve', args: [rfq, quote.usdIn] });
  const fillCall = encodeFunctionData({ abi: rastroRfqAbi, functionName: 'fill', args: [quote, row.signature as Hex] });
  const payer = ctx.signer('payer');

  if (ctx.batchCalls) {
    const receipt = await payer.wallet.sendTransactionSync({
      calls: [
        { to: usd, data: approve },
        { to: rfq, data: fillCall },
      ],
    });
    if (receipt.status !== 'success') throw new AppError(502, `o pagamento reverteu: ${receipt.transactionHash}`);
    return receipt.transactionHash;
  }
  const approval = await payer.wallet.sendTransaction({ to: usd, data: approve });
  await ctx.client.waitForTransactionReceipt({ hash: approval });
  const txHash = await payer.wallet.sendTransaction({ to: rfq, data: fillCall });
  const receipt = await ctx.client.waitForTransactionReceipt({ hash: txHash });
  if (receipt.status !== 'success') throw new AppError(502, `o pagamento reverteu: ${txHash}`);
  return txHash;
}
