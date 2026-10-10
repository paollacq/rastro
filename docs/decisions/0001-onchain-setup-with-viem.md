# 0001: On-chain setup with viem, not forge script

Date: 2026-10-10
Author:

## Context

The spec deployed the RFQ with `forge script` through tempo-foundry, with the token, the policy and the roles created by separate scripts. That is two toolchains talking to Moderato and a Foundry fork to install, with about two days left.

## Decision

One TypeScript script, `pnpm chain:setup`, runs the whole sequence with viem's Tempo actions: whitelist policy, tBRL, policy on the token, roles, the RFQ deployed from the bytecode that `forge build` exports, whitelist and stock.

Foundry stays for compiling and for the unit tests. forge-std and OpenZeppelin come in through pnpm, so there are no git submodules.

## Consequences

- Deploying needs Node only. Foundry is needed to change the contract.
- The script checks the chain before each step and records what it creates in `packages/chain/deployments/moderato.json`, which is committed. tBRL uses a fixed salt, so its address is predictable and a crashed run can't create a second token.
- After changing the contract: `pnpm contracts:build`, then clear `rfq` and `txs.rfq` in the deployments file, then `pnpm chain:setup`.
- Known limit: since Tempo's T6 upgrade a recipient can set a receive policy. If it blocks tBRL, the payout is held by Tempo's ReceivePolicyGuard instead of reverting, and the recipient's recovery authority has to release it. Rastro only quotes to wallets it registered and whitelisted, so the demo doesn't hit this.
