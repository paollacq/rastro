import { randomBytes } from 'node:crypto';
import { fromCents, toCents, type PixProvider, type PixTransfer } from './provider.ts';

// Our own Pix, for when the sandbox credential has expired and for the judges after the
// deadline. Same interface and the same amount rules as the PayZu sandbox. IDs follow the
// official format but with an institution code nobody uses (99999999) and a random part
// that starts with SIM, so no screen can pass one off as a real Pix.

export interface SimTransaction {
  id: string;
  type: 'DEPOSIT' | 'WITHDRAW';
  reference: string;
  amountBrl: string;
  pixKey: string | null;
  status: 'PENDING' | 'COMPLETED' | 'CANCELED';
  endToEndId: string | null;
  createdAt: Date;
  settlesAt: Date | null;
}

export interface SimulatorStore {
  // Inserts unless the reference already exists; returns the stored row either way.
  insert(tx: SimTransaction): Promise<SimTransaction>;
  byReference(reference: string): Promise<SimTransaction | null>;
  // PENDING -> COMPLETED. `changed` is false when someone else settled it first.
  settle(id: string, endToEndId: string): Promise<{ tx: SimTransaction; changed: boolean }>;
  all(): Promise<SimTransaction[]>;
}

export interface SimulatorOptions {
  startingBalanceBrl?: string; // like a fresh sandbox credential
  delayMs?: number; // how long a pending transaction takes
  now?: () => Date;
  onSettled?: (tx: SimTransaction) => Promise<void> | void; // our stand-in for the webhook
}

export class PixSimulator implements PixProvider {
  readonly name = 'simulator';

  constructor(
    private readonly store: SimulatorStore,
    private readonly options: SimulatorOptions = {},
  ) {}

  async createCharge({ amountBrl, reference }: { amountBrl: string; reference: string }) {
    const now = this.now();
    const tx = await this.store.insert({
      id: newId('simin'),
      type: 'DEPOSIT',
      reference,
      amountBrl: fromCents(toCents(amountBrl)),
      pixKey: null,
      status: 'PENDING',
      endToEndId: null,
      createdAt: now,
      settlesAt: new Date(now.getTime() + this.delay()),
    });
    return toTransfer(await this.settleIfDue(tx));
  }

  // Sandbox rules: under R$ 10 cancelled, up to R$ 100 settled at once, above that pending
  // for a moment. The demo withdrawal is above R$ 100, so the trail shows a real wait.
  async createWithdrawal(input: { amountBrl: string; pixKey: string; pixKeyType: string; reference: string }) {
    const cents = toCents(input.amountBrl);
    const now = this.now();
    const cancelled = cents < 1_000n;
    const tx = await this.store.insert({
      id: newId('simout'),
      type: 'WITHDRAW',
      reference: input.reference,
      amountBrl: fromCents(cents),
      pixKey: input.pixKey,
      status: cancelled ? 'CANCELED' : 'PENDING',
      endToEndId: null,
      createdAt: now,
      settlesAt: cancelled ? null : cents <= 10_000n ? now : new Date(now.getTime() + this.delay()),
    });
    return toTransfer(await this.settleIfDue(tx));
  }

  async findWithdrawal(reference: string) {
    const tx = await this.store.byReference(reference);
    if (!tx || tx.type !== 'WITHDRAW') return null;
    return toTransfer(await this.settleIfDue(tx));
  }

  async balance() {
    let cents = toCents(this.options.startingBalanceBrl ?? '10000.00');
    for (const tx of await this.store.all()) {
      if (tx.type === 'DEPOSIT' && tx.status === 'COMPLETED') cents += toCents(tx.amountBrl);
      if (tx.type === 'WITHDRAW' && tx.status !== 'CANCELED') cents -= toCents(tx.amountBrl);
    }
    return { availableBrl: fromCents(cents) };
  }

  private async settleIfDue(tx: SimTransaction) {
    if (tx.status !== 'PENDING' || !tx.settlesAt || this.now() < tx.settlesAt) return tx;
    const { tx: settled, changed } = await this.store.settle(tx.id, simulatedEndToEndId(this.now()));
    if (changed) await this.options.onSettled?.(settled);
    return settled;
  }

  private now() {
    return this.options.now?.() ?? new Date();
  }

  private delay() {
    return this.options.delayMs ?? 2_500;
  }
}

const ALPHANUMERIC = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';

function randomAlphanumeric(length: number) {
  // 62 symbols; rejection sampling keeps the distribution flat
  let out = '';
  while (out.length < length) {
    for (const byte of randomBytes(length * 2)) {
      if (byte < 248 && out.length < length) out += ALPHANUMERIC[byte % 62];
    }
  }
  return out;
}

// E + 99999999 + yyyyMMddHHmm (UTC) + SIM + 8 alphanumerics = 32 characters.
export function simulatedEndToEndId(at: Date) {
  const stamp = at.toISOString().replace(/\D/g, '').slice(0, 12);
  return `E99999999${stamp}SIM${randomAlphanumeric(8)}`;
}

const newId = (prefix: string) => `${prefix}_${randomAlphanumeric(12).toLowerCase()}`;

function toTransfer(tx: SimTransaction): PixTransfer {
  return {
    id: tx.id,
    reference: tx.reference,
    status: tx.status === 'CANCELED' ? 'FAILED' : tx.status,
    providerStatus: tx.status,
    amountBrl: tx.amountBrl,
    endToEndId: tx.endToEndId,
  };
}

// For tests and quick local runs without a database.
export function memoryStore(): SimulatorStore {
  const rows = new Map<string, SimTransaction>();
  return {
    async insert(tx) {
      const existing = [...rows.values()].find((row) => row.reference === tx.reference);
      if (existing) return { ...existing };
      rows.set(tx.id, { ...tx });
      return { ...tx };
    },
    async byReference(reference) {
      const found = [...rows.values()].find((row) => row.reference === reference);
      return found ? { ...found } : null;
    },
    async settle(id, endToEndId) {
      const row = rows.get(id);
      if (!row) throw new Error(`no simulated transaction ${id}`);
      if (row.status !== 'PENDING') return { tx: { ...row }, changed: false };
      Object.assign(row, { status: 'COMPLETED', endToEndId });
      return { tx: { ...row }, changed: true };
    },
    async all() {
      return [...rows.values()].map((row) => ({ ...row }));
    },
  };
}
