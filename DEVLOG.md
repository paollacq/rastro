# Devlog

A few lines a day, newest on top: what broke, what we decided and why.

## 2026-10-10

- RastroRFQ written to the spec. 18 Foundry tests on TIP-20 mocks: happy path, expiry, replay, wrong signer, payer changing the amount or the recipient, pause, a recipient outside the policy, admin-only calls, sweep, and a fuzz on amounts.
- The EIP-712 digest is pinned on both sides, in the Foundry test and in `quote.test.ts`. If the contract and the TypeScript signer drift apart, a test fails before Moderato does.
- On-chain setup moved from `forge script` to a single viem script (decision 0001).
- `pnpm setup` is a pnpm command, not our script. Root aliases now always use `pnpm --filter … run`.
- Not run on Moderato yet. First real run: `pnpm chain:setup`, then `pnpm chain:fill-test`.
