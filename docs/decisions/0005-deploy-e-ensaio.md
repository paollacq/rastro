# 0005: Repeating the demo, and the Pix account that runs out

Date: 2026-10-11
Author: Paolla Cardoso Queiroz, Bernardo Fischer Rigodanzo, Yasmin Franco dos Anjos

## Context

Etapa 5 asks for five runs of the whole demo in a row, on the public URL, without touching the code. The first rehearsal failed on the second run: the RFQ had R$ 1.706,74 of tBRL left and the invoice needs R$ 8.293,26.

## Decision

- **A run spends the Pix account, so the reset refills it.** Every withdrawal takes reais out of the sandbox and nothing puts them back. `pnpm demo:reset` now charges the account for whatever the stock is missing (`POST /v1/pix`, paid by the sandbox's simulated payer, about ten seconds) and only then squares the tBRL. Without that the demo can be run once per credential.
- **The reset is the unit, not the seed.** It checks the credential, lifts a pause if there is one, pulls tBRL back from Ana and the RFQ, burns it, mints the stock again up to what the reais allow, clears what the demo wrote, and puts Ana, the payer and invoice #0047 back. It keeps the people, the whitelist history and `chain_events`, so the console does not lose the dates it read from the chain. When everything is already in its first frame it touches the chain not at all, which is what makes five runs in a row cheap.
- **tBRL we cannot reach counts against the stock.** A wallet registered through the cadastro may hold a test real; we have no key for it, so the reset leaves it alone and mints that much less.
- **`pnpm ensaio` is the finish line, not a human with a stopwatch.** It drives the public API through quote, payment, withdrawal, Pix and burn, checks the Pix ID against the burn memo, times each step and repeats. What it cannot do is open an anonymous tab on someone else's computer, and it says so at the end.
- **The simulator settles on read.** A charge used to sit pending forever, because only a withdrawal lookup ever settled anything. `balance()` now settles whatever is due first, which is what a provider does.
- **In-flight backing expires after five minutes.** The window that keeps the monitor from pausing mid-withdrawal is bounded, so a withdrawal that is stuck stops hiding a real shortfall. Between the Pix request and its confirmation the provider may still hold the money, so for a few seconds it can be counted on both sides; that errs toward not pausing, which is the side a demo wants.
- **Three services, one `.env`.** The app signs for the payer, for Ana and for the admin, and the worker signs for the treasury and the admin, so both carry the same variables and nothing is exposed to the browser. `/api/health` answers for the database, the Tempo node, the Pix provider and the token's state in one request.

## Consequences

- The demo can be run as often as the sandbox allows charges. If a credential ever refuses them, `PIX_MODE=simulator` has no such limit.
- `demo:reset` moves money on-chain: it is for the demo's database and testnet, never for anything else.
- The five runs prove the path works; they do not prove it works from a cold cache in another country, which is what the anonymous-tab run is for.
