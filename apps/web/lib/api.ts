import { AppError, createContext, shortError, type Context } from '@rastro/core';
import { createHash, timingSafeEqual } from 'node:crypto';

// One context per server instance: one database pool, one set of signers.
let shared: Context | undefined;
export const context = () => (shared ??= createContext());

// Runs a route's work and turns errors into JSON the screens can show as they are.
export async function handle<T>(work: () => Promise<T>): Promise<Response> {
  try {
    return Response.json(await work());
  } catch (error) {
    if (error instanceof AppError) return Response.json({ error: error.message, code: error.code }, { status: error.status });
    console.error(error);
    return Response.json({ error: `something went wrong on our side: ${shortError(error)}`, code: 'internal' }, { status: 500 });
  }
}

// Everything under /api/admin needs the token from the server's .env. Without one set,
// the admin is closed rather than open.
export function requireAdmin(request: Request): void {
  const expected = process.env.ADMIN_TOKEN;
  if (!expected) throw new AppError(503, 'set ADMIN_TOKEN in the server .env to use the admin', 'no_admin_token');
  const given = request.headers.get('x-admin-token') ?? '';
  const digest = (value: string) => createHash('sha256').update(value).digest();
  if (!timingSafeEqual(digest(given), digest(expected))) {
    throw new AppError(401, 'admin token does not match', 'unauthorized');
  }
}

export async function readJson(request: Request): Promise<Record<string, unknown>> {
  try {
    const body = await request.json();
    return body && typeof body === 'object' ? (body as Record<string, unknown>) : {};
  } catch {
    throw new AppError(400, 'the body must be JSON');
  }
}
