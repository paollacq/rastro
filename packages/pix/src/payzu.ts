// Thin client for the PayZu Pix API. The sandbox (pix.sandbox.payzu.dev) has the
// same /v1 routes as production. Its credentials last 24 h, start with
// R$ 10,000.00 and cannot be renewed: a clean sandbox is a new credential.

export interface PixTransaction {
  id: string;
  status: string; // PENDING, COMPLETED, CANCELED, REFUNDED
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
    return this.request<unknown>('GET', '/user/balance');
  }

  createCharge(amount: number, clientReference: string) {
    return this.request<PixTransaction>('POST', '/pix', { amount, clientReference });
  }

  charge(clientReference: string) {
    return this.request<PixTransaction>('GET', `/pix?clientReference=${encodeURIComponent(clientReference)}`);
  }

  sendPix(body: SendPix) {
    return this.request<PixTransaction>('POST', '/withdraw', body);
  }

  payment(clientReference: string) {
    return this.request<PixTransaction>('GET', `/withdraw?clientReference=${encodeURIComponent(clientReference)}`);
  }

  private async request<T>(method: 'GET' | 'POST', path: string, body?: unknown): Promise<T> {
    const res = await fetch(`${this.baseUrl}/v1${path}`, {
      method,
      headers: { authorization: `Bearer ${this.token}`, 'content-type': 'application/json' },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    const text = await res.text();
    if (!res.ok) throw new PayZuError(res.status, `${method} ${path}`, text);
    return JSON.parse(text) as T;
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
