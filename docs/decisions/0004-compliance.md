# 0004: Cadastro, the policy and the reserve invariant

Date: 2026-10-11
Author:

## Context

Etapa 4 is the part a corretora would be asked about: who the client is, which wallets the token may reach, and whether every tBRL in circulation has a real behind it. Building it turned up one thing the spec had not: the invariant as written pauses the token in the middle of an ordinary withdrawal.

## Decision

- **The cadastro stores the hash of the CPF, never the CPF.** The salt comes from `CPF_SALT`. Without one we keep a random salt in `worker_state` so the demo still runs, which is enough for test documents and not enough for real ones: on a real deployment the salt belongs in the environment, away from the rows it protects. The screens and the report show `•••.982.247-••` and nothing more.
- **The cadastro is what puts a wallet on the policy.** Name, CPF with its check digit and a Pix key go in; `modifyPolicyWhitelist` goes out, signed by the admin, and the wallet is on TIP-403 policy 7. The document check is simulated; the policy call is real, and `policy_changes` records who asked for it.
- **The server holds the admin key.** Whitelisting and pausing are admin calls, so the process that serves `/api/kyc` and the worker both sign as admin. In production those two powers belong behind a multisig or the Account Keychain, not in one `.env`.
- **A blocked transfer is recorded from the node's own refusal.** The admin asks the chain to move R$ 1,00 of Ana's tBRL to a wallet; `eth_call` runs the policy and refuses with `PolicyForbids` before any block and without gas, and that refusal is what lands in `blocked_attempts`. Only `PolicyForbids` and `InvalidRecipient` count as blocked; a paused token or an empty wallet is our problem, not the policy's, and is reported as such.
- **The invariant counts the money in flight.** `supply <= reais in the Pix account + reais already paid out whose tBRL has not been burned yet`. Between the Pix leaving and the burn landing, a few seconds of every withdrawal, the balance has already dropped and the supply has not. Without that term the monitor pauses the token mid-withdrawal, and then the burn itself cannot run: the withdrawal is stuck with the Pix paid and the tBRL alive. We found this by running a withdrawal with the monitor on, and the console now shows the in-flight amount next to the balance.
- **Nothing unpauses itself.** The monitor pauses; a person restores, from `/admin` or `pnpm lastro:test`. A pause means a number did not add up, and that deserves a human.
- **The report is checked against the chain, not trusted.** `pnpm relatorio:conferir` reads the CSV back line by line and looks up every reference in `chain_events`: the fill and its memo, the transfer to the treasury, the burn and its Pix ID, and the reais recomputed from the PTAX and the spread. The tests run the same checks against a doctored CSV to prove they bite.
- **The TIP-20 mock asks the registry.** On a local chain the mock token now reads TIP-403 through the registry mock at its real address, the way a real TIP-20 does, so the cadastro-then-transfer path is exercised end to end without Moderato.

## Consequences

- A withdrawal that is in flight widens the backing by its own amount. A Pix that is paid and never burned would keep that slack open; the open withdrawals on the console are what makes it visible.
- The admin screen is gated by `ADMIN_TOKEN` only, and the token lives in the browser tab while it is open. It is an internal screen on a testnet; on anything else it needs a real session.
- Wallets registered through the cadastro can receive tBRL, but only Ana's wallet has a key on the server, so only she can withdraw. A test transfer to a generated wallet stays there.
