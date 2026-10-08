import { createPublicClient, createWalletClient, http, type LocalAccount } from 'viem';
import { tempoModerato } from 'viem/chains';
import { tempoActions } from 'viem/tempo';

export const chain = tempoModerato;
export const explorer = chain.blockExplorers.default.url;

const transport = () => http(process.env.TEMPO_RPC_URL || chain.rpcUrls.default.http[0]);

export const publicClient = () =>
  createPublicClient({ chain, transport: transport() }).extend(tempoActions());

export const walletClient = (account: LocalAccount) =>
  createWalletClient({ account, chain, transport: transport() }).extend(tempoActions());
