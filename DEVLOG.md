# Devlog

A few lines a day, newest on top: what broke, what we decided and why.

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
