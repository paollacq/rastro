# rastro

Dollars in on Tempo, reais out by Pix, with the Pix end-to-end ID written into the on-chain memo.

Testnet only. Nothing here moves real money.

## Setup

Node 22.9+, pnpm 10 and Foundry.

```bash
pnpm install
cp .env.example .env
pnpm wallets:new     # five testnet keys; paste them into .env
pnpm wallets:fund    # Moderato faucet, once per wallet
pnpm chain:check     # chain id, block height, pathUSD balances
```

Pix runs against the PayZu sandbox. Get a credential on the [sandbox page](https://docs.payzu.com.br/docs/pix-processamento/sandbox/credencial), put it in `PAYZU_TOKEN`, then:

```bash
pnpm pix:smoke       # one charge in, one payout out, both IDs checked against the memo format
pnpm test
cd contracts && forge build
```

## Layout

```text
contracts/        Foundry: TIP-20, factory and TIP-403 interfaces, precompile addresses
packages/chain    viem client for Moderato, roles, wallet scripts
packages/pix      PayZu client, end-to-end ID and memo helpers
apps/web          Next.js
apps/worker       long-running jobs (a block heartbeat for now)
docs/decisions    one page per decision, with date and author
```
