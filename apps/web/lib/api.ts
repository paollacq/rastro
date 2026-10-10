import { AppError, createContext, shortError, type Context } from '@rastro/core';

// One context per server instance: one database pool, one set of signers.
let shared: Context | undefined;
export const context = () => (shared ??= createContext());

// Runs a route's work and turns errors into JSON the screens can show as they are.
export async function handle<T>(work: () => Promise<T>): Promise<Response> {
  try {
    return Response.json(await work());
  } catch (error) {
    if (error instanceof AppError) return Response.json({ error: error.message }, { status: error.status });
    console.error(error);
    return Response.json({ error: `algo deu errado do nosso lado: ${shortError(error)}` }, { status: 500 });
  }
}

export async function readJson(request: Request): Promise<Record<string, unknown>> {
  try {
    const body = await request.json();
    return body && typeof body === 'object' ? (body as Record<string, unknown>) : {};
  } catch {
    throw new AppError(400, 'o corpo precisa ser JSON');
  }
}
