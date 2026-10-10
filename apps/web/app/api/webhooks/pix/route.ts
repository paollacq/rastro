import { handlePixWebhook } from '@rastro/core';
import { context } from '../../../../lib/api';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

// PayZu calls this. The signature covers the raw bytes, so the body is read as text.
export async function POST(request: Request) {
  const rawBody = await request.text();
  try {
    const { status, body } = await handlePixWebhook(context(), {
      rawBody,
      header: (name) => request.headers.get(name),
    });
    return Response.json(body, { status });
  } catch (error) {
    // A 5xx makes PayZu retry later, which is what we want if the database blinked.
    console.error(error);
    return Response.json({ error: 'tente de novo' }, { status: 503 });
  }
}
