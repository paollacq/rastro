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

One person generates the keys and passes the `.env` to the others privately. Everyone needs the same admin, treasury and quoter keys.

Pix runs against the PayZu sandbox. Get a credential on the [sandbox page](https://docs.payzu.com.br/docs/pix-processamento/sandbox/credencial), put it in `PAYZU_TOKEN`, then:

```bash
pnpm pix:smoke       # one charge in, one payout out, both IDs checked against the memo format
```

## Contracts and Moderato

```bash
pnpm contracts:build   # forge build, then copies the RFQ's ABI and bytecode into packages/chain
pnpm test              # Foundry tests on TIP-20 mocks, plus the TypeScript tests
pnpm chain:setup       # policy, tBRL, roles, RFQ, whitelist and R$ 10.000 of stock, on Moderato
pnpm chain:fill-test   # a signed quote, filled in one Tempo transaction, tBRL to Ana with the memo
```

`chain:setup` is run by one person. It skips whatever already exists, so running it again after an error is safe. It writes the addresses to `packages/chain/deployments/moderato.json`: commit that file and everyone, the app included, uses the same contracts.

`chain:fill-test` takes `--usd`, `--rate` and `--ref`. The demo invoice is `pnpm chain:fill-test --usd 1540 --ref fatura-0047`.

## Layout

```text
contracts/        RastroRFQ, TIP-20 / factory / TIP-403 interfaces, Foundry tests with TIP-20 mocks
packages/chain    viem client for Moderato, roles, quote signing, setup and fill-test scripts
packages/pix      PayZu client, end-to-end ID and memo helpers
apps/web          Next.js
apps/worker       long-running jobs (a block heartbeat for now)
docs/decisions    one page per decision, with date and author
```
