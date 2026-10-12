import { verifyCallback } from '@rastro/pix';
import type { Context } from './context.ts';

// POST /api/webhooks/pix. Answers the sandbox's ownership challenge, checks the HMAC
// before trusting a single byte, stores the event once per transaction and event type,
// and returns fast. The worker does the rest.

export interface WebhookRequest {
  rawBody: string;
  header(name: string): string | null;
}

export async function handlePixWebhook(ctx: Context, req: WebhookRequest): Promise<{ status: number; body: unknown }> {
  const challenge = req.header('x-callback-challenge');
  if (challenge) return { status: 200, body: { challenge } };

  if (!verifyCallback(req.header('x-callback-signature'), req.rawBody, ctx.webhookSecret, ctx.now().getTime())) {
    return { status: 401, body: { error: 'invalid signature' } };
  }

  let body: Record<string, unknown>;
  try {
    body = JSON.parse(req.rawBody);
  } catch {
    return { status: 400, body: { error: 'body is not JSON' } };
  }
  // The transaction itself, whether it comes bare or wrapped.
  const tx = (body.data ?? body.transaction ?? body) as Record<string, unknown>;
  if (!tx.id) return { status: 400, body: { error: 'missing transaction id' } };

  const status = typeof tx.status === 'string' ? tx.status : null;
  const fresh = await ctx.db.insertPixEvent({
    provider: 'payzu-sandbox',
    providerTxId: String(tx.id),
    event: req.header('x-callback-event') ?? `TRANSACTION_${status ?? 'UNKNOWN'}`,
    reference: typeof tx.clientReference === 'string' ? tx.clientReference : null,
    e2eId: typeof tx.endToEndId === 'string' ? tx.endToEndId : null,
    status,
    payload: tx,
    signatureOk: true,
  });
  return { status: 200, body: { ok: true, duplicate: !fresh } };
}
