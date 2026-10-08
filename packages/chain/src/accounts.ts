import type { Hex } from 'viem';
import { privateKeyToAccount } from 'viem/accounts';

// One testnet key per role, all read from .env.
export const roles = ['admin', 'treasury', 'quoter', 'payer', 'ana'] as const;
export type Role = (typeof roles)[number];

export const envName = (role: Role) => `${role.toUpperCase()}_PRIVATE_KEY`;

export function maybeAccount(role: Role) {
  const key = process.env[envName(role)];
  return key ? privateKeyToAccount(key as Hex) : undefined;
}

export function account(role: Role) {
  const found = maybeAccount(role);
  if (!found) throw new Error(`${envName(role)} is missing from .env (pnpm wallets:new prints one)`);
  return found;
}
