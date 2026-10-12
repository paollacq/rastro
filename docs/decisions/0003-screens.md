# 0003: Screens, and where they differ from the design tab

Date: 2026-10-10
Author: Paolla Cardoso Queiroz, Bernardo Fischer Rigodanzo, Yasmin Franco dos Anjos

## Context

Etapa 3 builds the five screens from the design tab. A few things only showed up with real data on the screen: the sandbox's 20-character IDs next to a 32-byte memo, a payer who leaves the tab open past the 30 s quote, a button that can race the automatic withdrawal, and English screens getting their errors from an API that answers in Portuguese.

## Decision

- **Pix ID over memo, not side by side.** The two IdBlocks sit one above the other, with the characters in the same columns, so each pair that lights up is a pair you can see. A sandbox ID leaves the last 12 bytes of the memo empty, and the screen shows them empty.
- **Mono where you compare, sans in sentences.** IDs, hashes and the receipt's columns are in IBM Plex Mono. An amount inside a sentence uses Instrument Sans with tabular figures.
- **One withdrawal in flight per invoice.** A unique index on `withdrawals (invoice_id)` while the status is not CANCELADO or DEVOLVIDO. A double click, or the button racing the automatic withdrawal, gets a 409 instead of a second Pix.
- **"Sacar automaticamente por Pix" applies from the moment it is switched on.** Invoices paid after that go out on the worker's next pass, once each. A Pix that fails is not retried by itself; the button comes back.
- **The whitelist comes from the chain.** The watcher copies TIP-403 `WhitelistUpdated` events for our policy into `chain_events`, with a cursor of its own that starts at the policy's creation. The console reads `isAuthorized` live for each wallet: events say since when, the registry says whether.
- **The trail is computed in one place,** `packages/core/src/trail.ts`, with no I/O, so the page can recompute it on every poll and the tests cover each state.
- **Errors carry a code.** The API keeps its Portuguese message and adds `code` (`quote_expired`, `insufficient_balance`…), which the English screens translate.
- **Fonts are self-hosted** from @fontsource, so a build doesn't depend on reaching Google Fonts.
- **The CSV export and the reserves read came early.** The console's button had to work, and both read data that already existed. Etapa 4 still has the cadastro, the blocked transfer, the monitor that pauses minting and the admin routes.

## Consequences

- The design tab's "lado a lado" no longer matches the screen; change one or the other.
- A partial withdrawal can't be followed by a second one for the same invoice. Whatever is left stays in the balance.
- The 404 page is static, so its warning strip shows the Pix mode of the last build.
