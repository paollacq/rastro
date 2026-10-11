import { registerClient } from '@rastro/core';
import { context, handle, readJson } from '../../../lib/api';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

// { name, cpf, pixKey, wallet, city? } -> the wallet goes on the TIP-403 whitelist and the
// client can receive tBRL. Only the hash of the CPF is stored.
export async function POST(request: Request) {
  return handle(async () => {
    const body = await readJson(request);
    return registerClient(context(), {
      name: String(body.name ?? ''),
      cpf: String(body.cpf ?? ''),
      pixKey: String(body.pixKey ?? ''),
      wallet: String(body.wallet ?? ''),
      city: typeof body.city === 'string' ? body.city : null,
    });
  });
}
