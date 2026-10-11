# Devlog

A few lines a day, newest on top: what broke, what we decided and why.

## 2026-10-11

- Etapa 4: cadastro that puts a wallet on the TIP-403 policy, a transfer the protocol refuses, the reserve monitor with its automatic pause, and the admin screen for the technical demo.
- The bug of the day: the monitor paused the token in the middle of an ordinary withdrawal. Between the Pix leaving and the burn landing, the balance is already down and the supply is not, so the invariant looked broken for four seconds. Pausing then makes the burn impossible, so the withdrawal freezes with the Pix paid. Backing now counts what is in flight, and there is a test that keeps it that way.
- The blocked attempt comes from the node's own refusal (`eth_call`, `PolicyForbids`), not from a reverted transaction: no gas, no block, and the reason in the console is the protocol's own.
- `pnpm relatorio:conferir` reads the CSV back and checks every line against chain_events, including recomputing the reais from the PTAX and the spread. Run against a doctored CSV in the tests, it finds all three kinds of edit.
- Local run: cadastro, barred transfer, allowed transfer, break, pause, restore and a withdrawal, all on anvil with the simulator. 42 tests in core.

## 2026-10-10, night

- Etapa 3: the five screens, from the design tab. Tested on anvil + Postgres through the browser: invoice paid, Ana withdraws, the trail fills in live and the stamp lands; then a second invoice with automatic withdrawal on, which the worker sent out by Pix five seconds after the payment.
- The two IDs went one over the other instead of side by side: with the columns lined up, each pair that lights up is visible as a pair (decision 0003).
- A double click on "Sacar" could start two withdrawals of the same invoice. Now a unique index allows one in flight per invoice, and the button or the worker gets a 409.
- The watcher now copies the TIP-403 whitelist events, with its own cursor, so the console's allowlist has dates and transactions without rereading the whole chain.
- Reserves after both withdrawals: supply R$ 1,060.52, simulator R$ 1,060.52.

## 2026-10-10, evening

- `pix:smoke` passed end to end (R$ 25 in, R$ 150 out, balance 10000 + 25 − 150 = 9875) but flagged both IDs: the sandbox returns 20-character IDs (`E` + unix time + 9 lowercase), not the official 32. Both formats are accepted now and the smoke prints which one it saw (decision 0002).
- Backend for Etapa 2: Postgres schema, PTAX quotes rounded to the centavo, demo payer, withdrawal state machine, chain watcher, PayZu webhook with HMAC, and a simulator that keeps its state in Postgres.
- The first review reproduced a double burn with two orchestrators running at once. Fixed with a lease row, sign-save-broadcast for every treasury transaction, and a claim on invoices. Tests for both races.
- Tested end to end on anvil + Postgres, through the real API routes and the worker: quote, pay, withdraw, Pix, burn with the Pix ID as memo, and the refund under R$ 10. Not yet on Moderato with the sandbox.
- `chain:setup` now mints no more tBRL than the sandbox balance backs (R$ 9.875 after the smoke).

## 2026-10-10

- RastroRFQ written to the spec. 18 Foundry tests on TIP-20 mocks: happy path, expiry, replay, wrong signer, payer changing the amount or the recipient, pause, a recipient outside the policy, admin-only calls, sweep, and a fuzz on amounts.
- The EIP-712 digest is pinned on both sides, in the Foundry test and in `quote.test.ts`. If the contract and the TypeScript signer drift apart, a test fails before Moderato does.
- On-chain setup moved from `forge script` to a single viem script (decision 0001).
- `pnpm setup` is a pnpm command, not our script. Root aliases now always use `pnpm --filter … run`.
- Not run on Moderato yet. First real run: `pnpm chain:setup`, then `pnpm chain:fill-test`.
