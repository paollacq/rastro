# 0002: Backend choices that differ from the spec

Date: 2026-10-10
Author: Paolla Cardoso Queiroz, Bernardo Fischer Rigodanzo, Yasmin Franco dos Anjos

## Context

Building Etapa 2 turned up a few places where the spec and reality disagree: the PayZu sandbox doesn't issue Pix IDs in the official format, Pix moves whole centavos, and the first review found ways to move money twice.

## Decision

- **Two ID formats.** The official end-to-end ID has 32 characters. The sandbox returns 20 (`E` + unix time + 9 lowercase characters). Both are accepted and both fit the memo; the trail shows which one it is. Only the official one fills the 32 bytes exactly.
- **Quotes round down to the centavo,** not to the token's smallest unit, so the tBRL Ana gets is always a Pix-able amount.
- **`pix_events` is unique per provider, transaction and event,** as PayZu recommends. A pending event has no end-to-end ID yet, so the spec's key (`e2e_id`, type) couldn't hold it.
- **New final status: CANCELADO,** for a withdrawal whose tBRL never left the wallet. FALHOU → DEVOLVIDO stays for a refused Pix.
- **The simulator writes its own event** instead of calling the webhook over HTTP with a signature. Same row, marked as the simulator's.
- **Demo custody.** The server signs for Ana and for the payer with their test keys, since the passkey was cut. The screens say so.
- **Money moves once:**
  - one orchestrator at a time, through a lease row (works behind a connection pooler);
  - transfers, burns and refunds are signed, saved and only then broadcast, so a retry pushes the same bytes;
  - the Pix provider is asked for the reference before sending;
  - an invoice is claimed by one payment at a time;
  - once a Pix is confirmed the only way forward is the burn.

## Consequences

- The pitch's "32 characters in 32 bytes" holds for real Pix and for the simulator. With the sandbox the screen shows a 20-character ID and says it comes from the sandbox.
- The end-to-end test covers quote → pay → withdraw → Pix → burn, the refund path, two orchestrators at once and two payments racing for one invoice. It runs on mock tokens and the simulator. Moderato and the PayZu sandbox still need a real run (`pnpm saque:test`).
