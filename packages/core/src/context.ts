import { account, deployed, pathUsd, publicClient, walletClient, type Role as KeyRole } from '@rastro/chain';
import { queries, sql, type Queries } from '@rastro/db';
import { PayZuProvider, PixSimulator, type PixProvider } from '@rastro/pix';
import type { Address, LocalAccount } from 'viem';
import { newId } from './money.ts';
import { simulatorStore } from './sim-store.ts';

// The admin key signs the policy and pause calls (Etapa 4), so the server holds it too.
// In production those belong behind a multisig, not in one process's environment.
export type Role = KeyRole;
export type ChainClient = ReturnType<typeof publicClient>;
export type Wallet = ReturnType<typeof walletClient>;

// Everything a service touches, in one place, so tests can swap any piece.
export interface Context {
  db: Queries;
  client: ChainClient;
  // policyId: the TIP-403 whitelist tBRL answers to; absent on a test chain without one.
  addresses: { tbrl: Address; rfq: Address; pathUsd: Address; treasury: Address; policyId?: bigint };
  signer(role: Role): { account: LocalAccount; wallet: Wallet };
  // Where new withdrawals go (PIX_MODE), and the provider an older one was sent through.
  pix: PixProvider;
  pixFor(name: string): PixProvider;
  spreadBps: number;
  // Approve and fill in one Tempo transaction. Off on a plain EVM test chain.
  batchCalls: boolean;
  webhookSecret: string | undefined;
  now(): Date;
  log(message: string): void;
  // Who holds the orchestrator lease when this process runs it.
  instanceId: string;
}

export function createContext(overrides: Partial<Context> = {}): Context {
  const db = overrides.db ?? queries(sql());
  const signers = new Map<Role, { account: LocalAccount; wallet: Wallet }>();
  const pix = overrides.pix ?? pixFromEnv(db);
  const others = new Map<string, PixProvider>();

  const addresses =
    overrides.addresses ??
    (() => {
      const { tbrl, rfq, policyId } = deployed();
      if (!tbrl || !rfq) throw new Error('No tBRL or RFQ address yet. Run pnpm chain:setup first.');
      return { tbrl, rfq, pathUsd, treasury: account('treasury').address, policyId };
    })();

  return {
    db,
    client: overrides.client ?? publicClient(),
    addresses,
    signer:
      overrides.signer ??
      ((role) => {
        let found = signers.get(role);
        if (!found) {
          const key = account(role);
          found = { account: key, wallet: walletClient(key) };
          signers.set(role, found);
        }
        return found;
      }),
    pix,
    pixFor: (name) => {
      if (name === pix.name) return pix;
      let found = others.get(name);
      if (!found) {
        found = name === 'simulator' ? simulator(db) : PayZuProvider.fromEnv();
        others.set(name, found);
      }
      return found;
    },
    spreadBps: overrides.spreadBps ?? Number(process.env.SPREAD_BPS || 50),
    // BATCH_CALLS=false only for a local EVM without Tempo transactions.
    batchCalls: overrides.batchCalls ?? process.env.BATCH_CALLS !== 'false',
    webhookSecret: overrides.webhookSecret ?? (process.env.PAYZU_WEBHOOK_SECRET || undefined),
    now: overrides.now ?? (() => new Date()),
    log: overrides.log ?? ((message) => console.log(message)),
    instanceId: overrides.instanceId ?? newId('proc', 10),
  };
}

export function pixMode(): 'sandbox' | 'simulator' {
  return process.env.PIX_MODE === 'simulator' ? 'simulator' : 'sandbox';
}

export function pixFromEnv(db: Queries): PixProvider {
  return pixMode() === 'sandbox' ? PayZuProvider.fromEnv() : simulator(db);
}

function simulator(db: Queries): PixProvider {
  return new PixSimulator(simulatorStore(db.sql), {
    // The simulator's stand-in for a webhook: the same row a verified delivery would write.
    onSettled: async (tx) => {
      await db.insertPixEvent({
        provider: 'simulator',
        providerTxId: tx.id,
        event: 'TRANSACTION_COMPLETED',
        reference: tx.reference,
        e2eId: tx.endToEndId,
        status: tx.status,
        payload: { ...tx, createdAt: tx.createdAt.toISOString(), settlesAt: tx.settlesAt?.toISOString() ?? null },
        signatureOk: true,
      });
    },
  });
}
