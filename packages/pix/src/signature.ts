import { createHmac, timingSafeEqual } from 'node:crypto';

// PayZu signs every delivery with X-Callback-Signature: "t=<unix seconds>, v1=<hex>",
// an HMAC-SHA256 of "<t>.<raw body>" keyed with the webhook's secret. The body has to be
// the exact bytes received, before any JSON parsing.

export const SIGNATURE_TOLERANCE_SECONDS = 300;

export function signCallback(secret: string, rawBody: string, t = Math.floor(Date.now() / 1000)) {
  const v1 = createHmac('sha256', secret).update(`${t}.${rawBody}`).digest('hex');
  return `t=${t}, v1=${v1}`;
}

export function verifyCallback(
  header: string | null | undefined,
  rawBody: string,
  secret: string | undefined,
  now = Date.now(),
): boolean {
  if (!header || !secret) return false;
  const fields = new Map<string, string>();
  for (const part of header.split(',')) {
    const at = part.indexOf('=');
    if (at > 0) fields.set(part.slice(0, at).trim(), part.slice(at + 1).trim());
  }
  const t = Number(fields.get('t'));
  const v1 = fields.get('v1') ?? '';
  if (!Number.isInteger(t) || !/^[0-9a-f]{64}$/i.test(v1)) return false;
  if (Math.abs(now / 1000 - t) > SIGNATURE_TOLERANCE_SECONDS) return false;

  const expected = createHmac('sha256', secret).update(`${t}.${rawBody}`).digest();
  const given = Buffer.from(v1, 'hex');
  return given.length === expected.length && timingSafeEqual(given, expected);
}
