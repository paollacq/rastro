import { AppError } from '@rastro/core';
import { context, handle, readJson } from '../../../lib/api';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const RELATIONS = ['recebo', 'pago', 'os dois'] as const;

// { email, relation?: "recebo" | "pago" | "os dois", lang?: "pt" | "en" } from the landing.
// Signing up twice is not an error; the answer just says so.
export async function POST(request: Request) {
  return handle(async () => {
    const body = await readJson(request);
    const email = typeof body.email === 'string' ? body.email.trim().toLowerCase() : '';
    if (email.length > 254 || !/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(email)) {
      throw new AppError(400, 'check the email: it is missing the @ or the domain', 'invalid_email');
    }
    const relation = RELATIONS.find((r) => r === body.relation) ?? null;
    const lang = body.lang === 'en' ? 'en' : 'pt';
    const added = await context().db.joinWaitlist({ email, relation, lang });
    return { added };
  });
}
