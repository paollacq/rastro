# Deploy

Three places: the database (Supabase or Neon), the app (Vercel) and the worker (Railway). The chain is already deployed, and its addresses are committed in `packages/chain/deployments/moderato.json`.

One person does this once, with the team's `.env` at hand. About 40 minutes the first time.

## 1. Database

Create a Postgres on Supabase or Neon and copy the **pooled** connection string (Supabase: port 6543, "Transaction" mode; the driver already runs with `prepare: false` for it).

```bash
DATABASE_URL='postgres://…' pnpm db:migrate
```

Every statement in `schema.sql` can run twice, so this is safe on every deploy.

## 2. App, on Vercel

New project from the repository, then:

| Setting | Value |
| --- | --- |
| Root Directory | `apps/web` |
| Include files outside the root directory | on (it is on by default; the app imports the workspace packages) |
| Framework | Next.js, detected |
| Node | 22 |

Environment variables: every line of `.env`, for Production and Preview. The app signs as the payer, as Ana and as the admin, so it needs the keys; there is nothing public to separate out, and nothing is exposed to the browser (no `NEXT_PUBLIC_*` anywhere).

Deploy, then open `https://<app>/api/health`. It answers 200 with one line per check:

```json
{"ok":true,"checks":{"database":{"ok":true,"detail":"…"},"tempo":{"ok":true,"detail":"bloco 123"},"pix":{"ok":true,"detail":"sandbox, R$ 10000.00 de lastro"},"tbrl":{"ok":true,"detail":"funcionando"}}}
```

## 3. Worker, on Railway

New service from the same repository. `railway.json` at the root already says how to build and start it:

```
build  pnpm install --frozen-lockfile
start  pnpm --filter @rastro/worker run start
```

Same environment variables as the app. No port, no healthcheck: it is a loop, not a server. The logs should show a line like

```
worker proc-xxxx up · Pix via payzu-sandbox · tBRL 0x… · treasury 0x…
12:00:00 alive · block 1234 · 0 open withdrawals · lastro ok
```

**One worker at a time.** A second one waits on the lease in Postgres and moves nothing, but there is no reason to pay for it.

## 4. Webhook

The sandbox only delivers to an address that answers its ownership challenge, so the app has to be up first:

```bash
pnpm pix:credencial https://<app>/api/webhooks/pix
```

It prints `PAYZU_WEBHOOK_SECRET=…` once. Put it in Vercel and in Railway, and redeploy both. Without it the app answers 401 to deliveries and the withdrawal still finishes, by polling, a couple of seconds later.

## 5. The demo's first frame

```bash
pnpm demo:reset        # against the deployed DATABASE_URL
pnpm ensaio --url https://<app> --runs 5
```

`demo:reset` tops the Pix account back up, squares the tBRL in circulation with it, clears what earlier runs wrote and leaves invoice #0047 open. `ensaio` then runs the whole demo five times through the public API and times each step. Five in a row with no error is the bar; if one fails, fix it and start the count again.

Then the part no script can do: open the demo in an anonymous tab, on another computer, with someone who did not write the code.

## Every day until the demo

The PayZu credential lasts 24 hours and does not renew.

```bash
# new credential from the sandbox page, into PAYZU_TOKEN (here, on Vercel and on Railway)
pnpm pix:credencial https://<app>/api/webhooks/pix   # checks it, registers the webhook, prints the secret
pnpm demo:reset                                      # the new credential comes with a fresh balance
```

A new credential means a new account with its own R$ 10.000,00, so the tBRL in circulation has to be squared with it; `demo:reset` does that. Until someone runs it, the worker notices the dead credential by itself, falls back to the simulator and every screen says "Pix simulado". Nothing breaks mid-demo.

## When something looks wrong

| What you see | Where to look |
| --- | --- |
| A withdrawal stuck at SOLICITADO | the worker is not running, or its lease is held by a second one |
| "Pix simulado" when you expected the sandbox | the credential died; `pnpm pix:credencial` |
| The console says minting is paused | the backing broke; `/admin` has the restore, `pnpm lastro` explains |
| A screen shows "não deu para carregar" | `/api/health` says which of the three is down |
| The report and the chain disagree | `pnpm relatorio:conferir` prints the line and the reason |
