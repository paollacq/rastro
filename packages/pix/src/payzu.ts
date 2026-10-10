import { fromCents, toCents, toPixStatus, type PixProvider, type PixTransfer } from './provider.ts';

// Thin client for the PayZu Pix API. The sandbox (pix.sandbox.payzu.dev) has the
// same /v1 routes as production. Its credentials last 24 h, start with
// R$ 10,000.00 and cannot be renewed: a clean sandbox is a new credential.

export interface PixTransaction {
  id: string;
  status: string; // PENDING, COMPLETED, CANCELED, REFUNDED, ...
  type: string; // DEPOSIT or WITHDRAW
  amount: number;
  endToEndId: string | null;
  clientReference: string | null;
  createdAt: string;
  paidAt: string | null;
}

export interface SendPix {
  amount: number;
  pixKey: string;
  pixType: string; // email, cpf, ...
  clientReference?: string;
  description?: string;
  callbackUrl?: string;
}

export interface Webhook {
  id: string;
  url: string;
  active: boolean;
  events: string[];
  hasSecret: boolean;
  secret?: string; // returned once, on creation
}

export interface WebhookChallenge {
  webhookId: string;
  url: string;
  status: 'pending' | 'verified' | 'failed';
  detail: string | null;
  checkedAt: string | null;
}

export class PayZu {
  constructor(
    private readonly token: string,
    private readonly baseUrl = 'https://pix.sandbox.payzu.dev',
  ) {}

  static fromEnv() {
    const token = process.env.PAYZU_TOKEN;
    if (!token) throw new Error('PAYZU_TOKEN is missing from .env');
    return new PayZu(token, process.env.PAYZU_BASE_URL || undefined);
  }

  balance() {
    return this.request<{ balanceAvailable: number; balanceBlocked: number }>('GET', '/v1/user/balance');
  }

  createCharge(amount: number, clientReference: string) {
    return this.request<PixTransaction>('POST', '/v1/pix', { amount, clientReference });
  }

  charge(clientReference: string) {
    return this.request<PixTransaction>('GET', `/v1/pix?clientReference=${encodeURIComponent(clientReference)}`);
  }

  sendPix(body: SendPix) {
    return this.request<PixTransaction>('POST', '/v1/withdraw', body);
  }

  payment(clientReference: string) {
    return this.request<PixTransaction>('GET', `/v1/withdraw?clientReference=${encodeURIComponent(clientReference)}`);
  }

  // Webhooks. In the sandbox a new webhook stays "pending" until the URL answers the
  // ownership challenge (see apps/web/app/api/webhooks/pix/route.ts).
  createWebhook(url: string) {
    return this.request<Webhook>('POST', '/v1/user/webhooks', { url, generateSecret: true });
  }

  webhooks() {
    return this.request<Webhook[]>('GET', '/v1/user/webhooks');
  }

  challenge(webhookId: string) {
    return this.request<WebhookChallenge>('GET', `/sandbox/webhooks/${encodeURIComponent(webhookId)}/challenge`);
  }

  retryChallenge(webhookId: string) {
    return this.request<WebhookChallenge>('POST', `/sandbox/webhooks/${encodeURIComponent(webhookId)}/challenge`);
  }

  private async request<T>(method: 'GET' | 'POST', path: string, body?: unknown): Promise<T> {
    const res = await fetch(`${this.baseUrl}${path}`, {
      method,
      headers: { authorization: `Bearer ${this.token}`, 'content-type': 'application/json' },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    const text = await res.text();
    if (!res.ok) throw new PayZuError(res.status, `${method} ${path.split('?')[0]}`, text);
    return (text ? JSON.parse(text) : null) as T;
  }
}

export class PayZuError extends Error {
  constructor(
    readonly status: number,
    route: string,
    readonly body: string,
  ) {
    super(`PayZu ${route} answered ${status}: ${body.slice(0, 300)}`);
  }
}

export class PayZuProvider implements PixProvider {
  readonly name = 'payzu-sandbox';

  constructor(private readonly api: PayZu) {}

  static fromEnv() {
    return new PayZuProvider(PayZu.fromEnv());
  }

  async createCharge({ amountBrl, reference }: { amountBrl: string; reference: string }) {
    return toTransfer(await this.api.createCharge(toAmount(amountBrl), reference), reference);
  }

  async createWithdrawal(input: { amountBrl: string; pixKey: string; pixKeyType: string; reference: string }) {
    const tx = await this.api.sendPix({
      amount: toAmount(input.amountBrl),
      pixKey: input.pixKey,
      pixType: input.pixKeyType,
      clientReference: input.reference,
      description: `Rastro ${input.reference}`,
    });
    return toTransfer(tx, input.reference);
  }

  async findWithdrawal(reference: string) {
    try {
      const found = await this.api.payment(reference);
      const tx = Array.isArray(found) ? found[0] : found;
      return tx ? toTransfer(tx, reference) : null;
    } catch (error) {
      if (error instanceof PayZuError && error.status === 404) return null;
      throw error;
    }
  }

  async balance() {
    const { balanceAvailable } = await this.api.balance();
    return { availableBrl: fromCents(toCents(balanceAvailable.toFixed(2))) };
  }
}

// PayZu takes reais as a JSON number; the amount always has whole centavos here.
const toAmount = (amountBrl: string) => Number(fromCents(toCents(amountBrl)));

function toTransfer(tx: PixTransaction, reference: string): PixTransfer {
  return {
    id: tx.id,
    reference: tx.clientReference ?? reference,
    status: toPixStatus(tx.status),
    providerStatus: tx.status,
    amountBrl: fromCents(toCents(Number(tx.amount).toFixed(2))),
    endToEndId: tx.endToEndId ?? null,
  };
}
