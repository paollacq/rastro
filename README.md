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
pnpm pix:smoke       # one charge in, one payout out, both IDs checked against the memo
```

## Contracts and Moderato

```bash
pnpm contracts:build   # forge build, then copies the RFQ's ABI and bytecode into packages/chain
pnpm chain:setup       # policy, tBRL, roles, RFQ, whitelist and stock, on Moderato
pnpm chain:fill-test   # a signed quote, filled in one Tempo transaction, tBRL to Ana with the memo
```

`chain:setup` is run by one person. It skips whatever already exists, so running it again after an error is safe. It writes the addresses to `packages/chain/deployments/moderato.json`: commit that file and everyone, the app included, uses the same contracts. With `PIX_MODE=sandbox` it mints no more tBRL than the sandbox balance backs.

`chain:fill-test` takes `--usd`, `--rate` and `--ref`.

## Backend

Postgres from Supabase or Neon in `DATABASE_URL`. Then:

```bash
pnpm db:migrate      # tables; safe to run on every deploy
pnpm db:seed         # Ana, Bramble & Pike and invoice #0047
pnpm fx:ptax         # the PTAX the quotes will use, straight from the Central Bank
pnpm dev             # app and API on localhost:3000
pnpm worker          # in another terminal: chain watcher and withdrawal state machine
pnpm saque:test      # a withdrawal end to end, checked against the burn memo
```

`PIX_MODE=sandbox` sends Pix through PayZu; `PIX_MODE=simulator` uses our own simulator, with the same rules and IDs in the official format from a made-up institution (99999999). Switch when the 24 h credential runs out.

The webhook needs a public HTTPS address (the deploy, or a tunnel to localhost):

```bash
pnpm pix:webhook https://<app>/api/webhooks/pix   # prints PAYZU_WEBHOOK_SECRET once
```

| Route | What it does |
| --- | --- |
| `POST /api/quote` | `{ invoiceId }` → quote signed by the quoter, PTAX, spread, valid 30 s |
| `POST /api/pay` | `{ quoteId }` → the demo payer approves and fills in one Tempo transaction |
| `POST /api/withdraw` | `{ amountBrl, invoiceId? }` → Ana's tBRL to the treasury, memo = withdrawal id |
| `POST /api/webhooks/pix` | PayZu deliveries: ownership challenge, HMAC check, stored once |
| `GET /api/trace/:id` | `fatura-0047` or `saque-…` → the whole trail |
| `POST /api/settings` | `{ autoWithdraw }` → Ana's payments go out by Pix on their own, from now on |
| `POST /api/waitlist` | `{ email, relation? }` from the landing, once per address |
| `GET /api/report.csv` | `?from=2026-10-01&to=2026-10-31` → every operation: origin, destination, rate, Pix ID, Tempo transactions |
| `GET /api/reserves` | tBRL supply against the reais in the Pix account |

A withdrawal goes SOLICITADO → TBRL_NA_TESOURARIA → PIX_ENVIADO → PIX_CONFIRMADO → QUEIMADO → CONCLUIDO, or FALHOU → DEVOLVIDO when the Pix is refused. Run one worker; a second one waits for the first one's lease.

## Screens

With `pnpm dev` and `pnpm worker` running:

| Path | For | What it shows |
| --- | --- | --- |
| `/` | anyone | the sentence, a real trail from the testnet, the waitlist |
| `/invoice/0047` | the payer, in English | the invoice, a PTAX quote locked for 30 s, the pay button |
| `/ana` | Ana, in Portuguese (`?lang=en` for English) | tBRL balance, payments in, withdraw by Pix, automatic withdrawal |
| `/trace/fatura-0047` | anyone with the link | the six steps, the Pix ID over the burn memo, the CONFERIDO stamp |
| `/console` | the institution, in English | operations and the CSV, allowlist, blocked transfers, reserves |

The trail page asks the API every second until nothing is left to happen. Ana's automatic withdrawal is saved in Postgres; the worker does the withdrawing. Why some things differ from the design tab: decision 0003.

The landing's footer reads `apps/web/lib/team.ts`. Put your names, links and city there; it shows nothing until you do.

## Tests

```bash
pnpm test    # Foundry and unit tests
```

With a local Postgres and `anvil --chain-id 42431` running, two integration suites also run:

```bash
TEST_DATABASE_URL=postgres://… pnpm --filter @rastro/db test
E2E_RPC_URL=http://127.0.0.1:8545 E2E_DATABASE_URL=postgres://… pnpm --filter @rastro/core test
```

Both suites begin by dropping the `public` schema, so those two variables must point at a
throwaway database, never the one in `DATABASE_URL`. They refuse to run if it is the same
host, port and database name.

The second one pays invoice 0047, withdraws it to a simulated Pix and checks the burn memo, on mock TIP-20s and a mock TIP-403 registry. It also covers the automatic withdrawal and what the screens read: wallet, ledger, whitelist and reserves.

## Layout

```text
contracts/        RastroRFQ, TIP-20 / factory / TIP-403 interfaces, Foundry tests with TIP-20 mocks
packages/chain    viem client for Moderato, roles, quote signing, setup and fill-test scripts
packages/pix      PayZu client, simulator, webhook signature, end-to-end ID formats
packages/db       Postgres schema and queries
packages/core     quotes, payments, withdrawals, watcher, webhook, trail, what each screen reads
apps/web          Next.js: screens and the API routes
apps/worker       the loop that runs the watcher and the withdrawal state machine
docs/decisions    one page per decision, with date and author
```
