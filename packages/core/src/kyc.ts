import { explorer, tip403Registry } from '@rastro/chain';
import { isCpf, maskCpf, parsePixKey, InvalidKey } from '@rastro/pix';
import { createHash, randomBytes } from 'node:crypto';
import { getAddress, isAddress, type Hash } from 'viem';
import { Abis } from 'viem/tempo';
import type { Context } from './context.ts';
import { AppError } from './errors.ts';
import { newId } from './money.ts';
import { writeAndWait } from './tx.ts';

// The cadastro, simulated: name, CPF and Pix key go in, the wallet goes on the TIP-403
// whitelist, and from then on the protocol itself lets tBRL reach it. Only the hash of the
// CPF is stored; the screens never show more than the masked form.
//
// What a real one would add: a document photo, a liveness check and a sanctions list. What
// is real here is the on-chain part — the policy call and the record of who made it.

export interface KycInput {
  name: string;
  cpf: string;
  pixKey: string;
  wallet: string;
  city?: string | null;
}

export interface KycResult {
  id: string;
  name: string;
  wallet: string;
  cpfMasked: string;
  pixKeyMasked: string;
  pixKeyType: string;
  policyId: string;
  txHash: string | null;
  explorer: string;
  // true when the wallet was already on the policy, so no transaction was needed
  alreadyOnPolicy: boolean;
}

export async function registerClient(ctx: Context, input: KycInput): Promise<KycResult> {
  const name = input.name.trim().replace(/\s+/g, ' ');
  if (!/^[\p{L}][\p{L}'.-]*( [\p{L}'.-]+)+$/u.test(name)) {
    throw new AppError(400, 'escreva o nome completo, como está no documento', 'invalid_name');
  }
  if (!isCpf(input.cpf)) {
    throw new AppError(400, 'esse CPF não passa no dígito verificador; confira os números', 'invalid_cpf');
  }
  let key;
  try {
    key = parsePixKey(input.pixKey);
  } catch (error) {
    if (error instanceof InvalidKey) throw new AppError(400, error.message, 'invalid_pix_key');
    throw error;
  }
  if (!isAddress(input.wallet)) {
    throw new AppError(400, 'carteira inválida: são 42 caracteres começando com 0x', 'invalid_wallet');
  }
  const wallet = getAddress(input.wallet);
  const { policyId } = ctx.addresses;
  if (policyId === undefined) {
    throw new AppError(409, 'não há política TIP-403 configurada; rode pnpm chain:setup', 'no_policy');
  }

  const cpfHash = await hashCpf(ctx, input.cpf);
  const byCpf = await ctx.db.userByCpfHash(cpfHash);
  const byWallet = await ctx.db.userByWallet(wallet);
  if (byCpf && byCpf.wallet.toLowerCase() !== wallet.toLowerCase()) {
    throw new AppError(409, 'esse CPF já tem cadastro com outra carteira', 'cpf_taken');
  }
  if (byWallet && byWallet.id !== byCpf?.id) {
    throw new AppError(409, 'essa carteira já é de outro cadastro', 'wallet_taken');
  }

  // The policy is the thing that matters, so it is read from the registry, not from us.
  const already = await ctx.client.readContract({
    address: tip403Registry,
    abi: Abis.tip403Registry,
    functionName: 'isAuthorized',
    args: [policyId, wallet],
  });

  let txHash: Hash | null = null;
  if (!already) {
    txHash = await writeAndWait(
      ctx,
      'admin',
      {
        address: tip403Registry,
        abi: Abis.tip403Registry,
        functionName: 'modifyPolicyWhitelist',
        args: [policyId, wallet, true],
      },
      'a inclusão na política',
    );
  }

  const id = byCpf?.id ?? byWallet?.id ?? newId('cliente', 6);
  await ctx.db.upsertUser({
    id,
    role: 'recebedora',
    name,
    wallet,
    cpfHash,
    cpfMasked: maskCpf(input.cpf),
    pixKey: key.value,
    pixKeyType: key.type,
    pixKeyMasked: key.masked,
    kycStatus: 'aprovado',
    city: input.city?.trim() || null,
  });
  await ctx.db.insertPolicyChange({ wallet: wallet.toLowerCase(), allowed: true, txHash, actor: `cadastro ${id}` });

  return {
    id,
    name,
    wallet,
    cpfMasked: maskCpf(input.cpf),
    pixKeyMasked: key.masked,
    pixKeyType: key.type,
    policyId: policyId.toString(),
    txHash,
    explorer,
    alreadyOnPolicy: Boolean(already),
  };
}

// The CPF never leaves this process in the clear. The salt belongs in the environment;
// without one we keep a random salt in the database, which is enough for test documents
// and is written down as a limitation in decision 0004.
const SALT_KEY = 'cpf_salt';

async function hashCpf(ctx: Context, cpf: string): Promise<string> {
  const salt = process.env.CPF_SALT || (await storedSalt(ctx));
  return createHash('sha256').update(`${salt}:${cpf.replace(/\D/g, '')}`).digest('hex');
}

async function storedSalt(ctx: Context): Promise<string> {
  const saved = await ctx.db.state(SALT_KEY);
  if (saved) return saved;
  const fresh = randomBytes(16).toString('hex');
  await ctx.db.setState(SALT_KEY, fresh);
  // setState overwrites, so two processes racing could pick different salts; read back.
  return (await ctx.db.state(SALT_KEY)) ?? fresh;
}
