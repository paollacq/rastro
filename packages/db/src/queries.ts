import type { Sql } from './client.ts';

export type WithdrawalStatus =
  | 'SOLICITADO'
  | 'TBRL_NA_TESOURARIA'
  | 'PIX_ENVIADO'
  | 'PIX_CONFIRMADO'
  | 'QUEIMADO'
  | 'CONCLUIDO'
  | 'FALHOU'
  | 'DEVOLVIDO'
  | 'CANCELADO';

export const FINAL_STATUSES: readonly WithdrawalStatus[] = ['CONCLUIDO', 'DEVOLVIDO', 'CANCELADO'];

// Rows as they come back: numerics and bigints are strings, timestamps are Dates.
export interface User {
  id: string;
  role: 'recebedora' | 'pagador';
  name: string;
  wallet: string;
  cpfHash: string | null;
  cpfMasked: string | null;
  pixKey: string | null;
  pixKeyType: string | null;
  pixKeyMasked: string | null;
  kycStatus: string;
  city: string | null;
  autoWithdrawSince: Date | null;
  createdAt: Date;
}

export interface Invoice {
  id: string;
  number: string;
  payerName: string;
  payerWallet: string;
  recipientId: string;
  description: string;
  amountUsd: string;
  status: 'aberta' | 'paga';
  items: InvoiceItem[];
  payingQuote: string | null;
  payingSince: Date | null;
  paidAt: Date | null;
  createdAt: Date;
}

// A line on the invoice as the payer reads it: "Backend work, September", 28 h at US$ 55.
export interface InvoiceItem {
  description: string;
  hours: number;
  rateUsd: string;
}

export interface Quote {
  id: string;
  invoiceId: string;
  payer: string;
  recipient: string;
  ptaxDate: string;
  ptaxRate: string;
  spreadBps: number;
  usdIn: string;
  brlOut: string;
  invoiceRef: string;
  nonce: string;
  expiry: Date;
  signature: string;
  fillTx: string | null;
  createdAt: Date;
}

export interface ChainEvent {
  txHash: string;
  logIndex: number;
  blockNumber: string;
  blockTime: Date | null;
  contract: string;
  event: string;
  fromAddress: string | null;
  toAddress: string | null;
  amount: string | null;
  memo: string | null;
  memoText: string | null;
  args: Record<string, unknown>;
}

export interface Withdrawal {
  id: string;
  userId: string;
  invoiceId: string | null;
  amountBrl: string;
  status: WithdrawalStatus;
  transferTx: string | null;
  provider: string | null;
  providerId: string | null;
  e2eId: string | null;
  burnTx: string | null;
  refundTx: string | null;
  failure: string | null;
  createdAt: Date;
  updatedAt: Date;
}

export interface WithdrawalStep {
  id: string;
  withdrawalId: string;
  status: WithdrawalStatus;
  detail: string | null;
  at: Date;
}

export interface PixEvent {
  id: string;
  provider: string;
  providerTxId: string;
  event: string;
  reference: string | null;
  e2eId: string | null;
  status: string | null;
  payload: Record<string, unknown>;
  signatureOk: boolean;
  receivedAt: Date;
}

// What a recipient was paid: one row per invoice, with the quote it was filled at.
export interface Payment {
  invoiceId: string;
  number: string;
  payerName: string;
  description: string;
  amountUsd: string;
  quoteId: string;
  ptaxRate: string;
  ptaxDate: string;
  spreadBps: number;
  usdIn: string;
  brlOut: string;
  fillTx: string;
  paidAt: Date;
}

// A line of the institution's ledger. A conversion is a paid invoice, with the
// withdrawal that took it out by Pix, if any; a withdrawal on its own has no invoice.
export interface Operation {
  kind: 'conversao' | 'saque';
  at: Date;
  userId: string;
  clientName: string;
  cpfMasked: string | null;
  clientWallet: string;
  pixKeyMasked: string | null;
  invoiceId: string | null;
  invoiceNumber: string | null;
  payerName: string | null;
  payerWallet: string | null;
  usdIn: string | null;
  ptaxRate: string | null;
  ptaxDate: string | null;
  spreadBps: number | null;
  brlOut: string | null;
  fillTx: string | null;
  withdrawalId: string | null;
  withdrawnBrl: string | null;
  withdrawalStatus: WithdrawalStatus | null;
  e2eId: string | null;
  provider: string | null;
  transferTx: string | null;
  burnTx: string | null;
}

export interface PolicyChange {
  id: string;
  wallet: string;
  allowed: boolean;
  txHash: string | null;
  actor: string;
  at: Date;
}

export interface BlockedAttempt {
  id: string;
  fromAddress: string | null;
  toAddress: string | null;
  amount: string | null;
  reason: string;
  at: Date;
}

export interface ReserveCheck {
  id: string;
  supply: string;
  balanceBrl: string;
  ok: boolean;
  at: Date;
}

export interface OutboxTx {
  hash: string;
  withdrawalId: string | null;
  kind: 'transfer' | 'burn' | 'refund';
  signer: string;
  nonce: number;
  raw: string;
}

type New<T, Optional extends keyof T = never> = Omit<T, Optional | 'createdAt'> & Partial<Pick<T, Optional>>;

export type NewUser = New<
  User,
  'cpfHash' | 'cpfMasked' | 'pixKey' | 'pixKeyType' | 'pixKeyMasked' | 'kycStatus' | 'city' | 'autoWithdrawSince'
>;
export type NewInvoice = New<Invoice, 'status' | 'items' | 'payingQuote' | 'payingSince' | 'paidAt'>;
export type NewQuote = New<Quote, 'fillTx'>;
export type NewChainEvent = ChainEvent;
export type NewPixEvent = Omit<PixEvent, 'id' | 'receivedAt'>;
type WithdrawalPatch = Partial<
  Pick<Withdrawal, 'transferTx' | 'provider' | 'providerId' | 'e2eId' | 'burnTx' | 'refundTx' | 'failure'>
>;

export function queries(sql: Sql) {
  return {
    sql,

    async upsertUser(user: NewUser) {
      const [row] = await sql<User[]>`
        insert into users ${sql(user as Record<string, unknown>)}
        on conflict (id) do update set
          name = excluded.name, wallet = excluded.wallet, role = excluded.role,
          pix_key = excluded.pix_key, pix_key_type = excluded.pix_key_type,
          pix_key_masked = excluded.pix_key_masked, kyc_status = excluded.kyc_status,
          city = excluded.city
        returning *`;
      return row;
    },

    async user(id: string) {
      const [row] = await sql<User[]>`select * from users where id = ${id}`;
      return row ?? null;
    },

    async users() {
      return sql<User[]>`select * from users order by created_at`;
    },

    async userByCpfHash(cpfHash: string) {
      const [row] = await sql<User[]>`select * from users where cpf_hash = ${cpfHash}`;
      return row ?? null;
    },

    async userByWallet(wallet: string) {
      const [row] = await sql<User[]>`select * from users where lower(wallet) = lower(${wallet})`;
      return row ?? null;
    },

    async upsertInvoice(invoice: NewInvoice) {
      // jsonb wants sql.json: a plain array would go in as a Postgres array.
      const row = { ...invoice, items: sql.json((invoice.items ?? []) as never) };
      const [saved] = await sql<Invoice[]>`
        insert into invoices ${sql(row as Record<string, unknown>)}
        on conflict (id) do update set
          payer_name = excluded.payer_name, payer_wallet = excluded.payer_wallet,
          recipient_id = excluded.recipient_id, description = excluded.description,
          amount_usd = excluded.amount_usd, items = excluded.items
        returning *`;
      return saved;
    },

    async invoice(id: string) {
      const [row] = await sql<Invoice[]>`select * from invoices where id = ${id}`;
      return row ?? null;
    },

    async invoiceByNumber(number: string) {
      const [row] = await sql<Invoice[]>`select * from invoices where number = ${number}`;
      return row ?? null;
    },

    // `at` is when the fill happened: now, from the payment route, or the block time when
    // the watcher is the first to see it. The first one to arrive stays.
    async markInvoicePaid(id: string, at: Date = new Date()) {
      await sql`
        update invoices set status = 'paga', paid_at = coalesce(paid_at, ${at}), paying_quote = null, paying_since = null
        where id = ${id}`;
    },

    // One payment at a time per invoice. A claim older than two minutes is considered dead.
    async claimInvoice(id: string, quoteId: string) {
      const rows = await sql`
        update invoices set paying_quote = ${quoteId}, paying_since = now()
        where id = ${id} and status = 'aberta'
          and (paying_quote is null or paying_quote = ${quoteId} or paying_since < now() - interval '2 minutes')
        returning id`;
      return rows.length > 0;
    },

    async releaseInvoice(id: string, quoteId: string) {
      await sql`update invoices set paying_quote = null, paying_since = null where id = ${id} and paying_quote = ${quoteId}`;
    },

    async insertQuote(quote: NewQuote) {
      const [row] = await sql<Quote[]>`insert into quotes ${sql(quote as Record<string, unknown>)} returning *`;
      return row;
    },

    async quote(id: string) {
      const [row] = await sql<Quote[]>`select * from quotes where id = ${id}`;
      return row ?? null;
    },

    async quotesForInvoice(invoiceId: string) {
      return sql<Quote[]>`select * from quotes where invoice_id = ${invoiceId} order by created_at`;
    },

    async setQuoteFill(id: string, fillTx: string) {
      await sql`update quotes set fill_tx = ${fillTx} where id = ${id}`;
    },

    // The last PTAX we used, for when the Central Bank's API is down.
    async lastPtax() {
      const [row] = await sql<{ ptaxDate: string; ptaxRate: string }[]>`
        select ptax_date, ptax_rate from quotes order by created_at desc limit 1`;
      return row ?? null;
    },

    async insertWithdrawal(withdrawal: { id: string; userId: string; invoiceId: string | null; amountBrl: string }, detail: string) {
      return sql.begin(async (tx) => {
        const [row] = await tx<Withdrawal[]>`
          insert into withdrawals ${tx({ ...withdrawal, status: 'SOLICITADO' })} returning *`;
        await tx`insert into withdrawal_steps ${tx({ withdrawalId: row.id, status: 'SOLICITADO', detail })}`;
        return row;
      });
    },

    async withdrawal(id: string) {
      const [row] = await sql<Withdrawal[]>`select * from withdrawals where id = ${id}`;
      return row ?? null;
    },

    async withdrawalsForInvoice(invoiceId: string) {
      return sql<Withdrawal[]>`select * from withdrawals where invoice_id = ${invoiceId} order by created_at`;
    },

    async withdrawalsOf(userId: string, limit = 50) {
      return sql<Withdrawal[]>`
        select * from withdrawals where user_id = ${userId} order by created_at desc limit ${limit}`;
    },

    // The most complete trail there is, for the landing page: a finished withdrawal, one
    // that came from an invoice if possible.
    async showcaseWithdrawal() {
      const [row] = await sql<{ id: string }[]>`
        select id from withdrawals where status = 'CONCLUIDO'
        order by (invoice_id is not null) desc, updated_at desc
        limit 1`;
      return row?.id ?? null;
    },

    async openWithdrawals() {
      return sql<Withdrawal[]>`
        select * from withdrawals where status not in ('CONCLUIDO', 'DEVOLVIDO', 'CANCELADO') order by created_at`;
    },

    // Records a transaction hash before waiting for it, without moving the status.
    async patchWithdrawal(id: string, patch: WithdrawalPatch) {
      await sql`update withdrawals set ${sql({ ...patch, updatedAt: new Date() } as Record<string, unknown>)} where id = ${id}`;
    },

    // Moves a withdrawal only if it is still where we think it is, and logs the step.
    // Returns null when another process got there first.
    async advance(id: string, from: WithdrawalStatus, to: WithdrawalStatus, patch: WithdrawalPatch, detail: string) {
      return sql.begin(async (tx) => {
        const [row] = await tx<Withdrawal[]>`
          update withdrawals set ${tx({ ...patch, status: to, updatedAt: new Date() } as Record<string, unknown>)}
          where id = ${id} and status = ${from}
          returning *`;
        if (!row) return null;
        await tx`insert into withdrawal_steps ${tx({ withdrawalId: id, status: to, detail })}`;
        return row;
      });
    },

    async steps(withdrawalId: string) {
      return sql<WithdrawalStep[]>`
        select * from withdrawal_steps where withdrawal_id = ${withdrawalId} order by at, id`;
    },

    async insertChainEvents(events: NewChainEvent[]) {
      if (events.length === 0) return 0;
      const rows = events.map((event) => ({ ...event, args: sql.json(event.args as never) }));
      const inserted = await sql`
        insert into chain_events ${sql(rows as unknown as Record<string, unknown>[])}
        on conflict (tx_hash, log_index) do nothing
        returning tx_hash`;
      return inserted.length;
    },

    async findMemoTransfer(filter: { contract: string; to: string; memoText: string; from?: string }) {
      const [row] = await sql<ChainEvent[]>`
        select * from chain_events
        where contract = ${filter.contract.toLowerCase()}
          and event = 'TransferWithMemo'
          and to_address = ${filter.to.toLowerCase()}
          and memo_text = ${filter.memoText}
          ${filter.from ? sql`and from_address = ${filter.from.toLowerCase()}` : sql``}
        order by block_number, log_index
        limit 1`;
      return row ?? null;
    },

    // Any memo transfer sent by `from` with this memo, wherever it went (a burn included).
    async findMemoSent(filter: { contract: string; from: string; memoText: string }) {
      const [row] = await sql<ChainEvent[]>`
        select * from chain_events
        where contract = ${filter.contract.toLowerCase()}
          and event = 'TransferWithMemo'
          and from_address = ${filter.from.toLowerCase()}
          and memo_text = ${filter.memoText}
        order by block_number, log_index
        limit 1`;
      return row ?? null;
    },

    async chainEventsForTxs(txHashes: string[]) {
      if (txHashes.length === 0) return [];
      return sql<ChainEvent[]>`
        select * from chain_events where tx_hash in ${sql(txHashes.map((hash) => hash.toLowerCase()))}
        order by block_number, log_index`;
    },

    async paymentsTo(userId: string) {
      return sql<Payment[]>`
        select i.id as invoice_id, i.number, i.payer_name, i.description, i.amount_usd,
          q.id as quote_id, q.ptax_rate, q.ptax_date, q.spread_bps, q.usd_in, q.brl_out, q.fill_tx,
          coalesce(e.block_time, i.paid_at, q.created_at) as paid_at
        from invoices i
        join quotes q on q.invoice_id = i.id and q.fill_tx is not null
        left join chain_events e on e.tx_hash = lower(q.fill_tx) and e.event = 'Filled'
        where i.recipient_id = ${userId}
        order by paid_at desc, i.paid_at desc nulls last, i.number desc`;
    },

    // Every conversion and every withdrawal, newest first. Cancelled withdrawals never
    // moved money, so they stay out of the ledger.
    async operations(range: { from?: Date; to?: Date } = {}, limit = 500) {
      return sql<Operation[]>`
        with conversions as (
          select 'conversao' as kind, coalesce(e.block_time, i.paid_at, q.created_at) as at,
            u.id as user_id, u.name as client_name, u.cpf_masked, u.wallet as client_wallet, u.pix_key_masked,
            i.id as invoice_id, i.number as invoice_number, i.payer_name, i.payer_wallet,
            q.usd_in, q.ptax_rate, q.ptax_date, q.spread_bps, q.brl_out, q.fill_tx,
            w.id as withdrawal_id, w.amount_brl as withdrawn_brl, w.status as withdrawal_status,
            w.e2e_id, w.provider, w.transfer_tx, w.burn_tx
          from invoices i
          join users u on u.id = i.recipient_id
          join quotes q on q.invoice_id = i.id and q.fill_tx is not null
          left join chain_events e on e.tx_hash = lower(q.fill_tx) and e.event = 'Filled'
          left join lateral (
            select * from withdrawals w where w.invoice_id = i.id and w.status <> 'CANCELADO'
            order by w.created_at desc limit 1
          ) w on true
        ),
        withdrawals_alone as (
          select 'saque' as kind, w.created_at as at,
            u.id as user_id, u.name as client_name, u.cpf_masked, u.wallet as client_wallet, u.pix_key_masked,
            null::text as invoice_id, null::text as invoice_number, null::text as payer_name, null::text as payer_wallet,
            null::numeric as usd_in, null::numeric as ptax_rate, null::text as ptax_date, null::integer as spread_bps,
            null::numeric as brl_out, null::text as fill_tx,
            w.id as withdrawal_id, w.amount_brl as withdrawn_brl, w.status as withdrawal_status,
            w.e2e_id, w.provider, w.transfer_tx, w.burn_tx
          from withdrawals w
          join users u on u.id = w.user_id
          where w.invoice_id is null and w.status <> 'CANCELADO'
        )
        select * from (select * from conversions union all select * from withdrawals_alone) ops
        where ${range.from ? sql`at >= ${range.from}` : sql`true`}
          and ${range.to ? sql`at < ${range.to}` : sql`true`}
        order by at desc, invoice_number desc nulls last, withdrawal_id
        limit ${limit}`;
    },

    // TIP-403 whitelist changes for one policy, as the watcher copied them, oldest first.
    async policyEvents(registry: string, policyId: string) {
      return sql<ChainEvent[]>`
        select * from chain_events
        where contract = ${registry.toLowerCase()} and event = 'WhitelistUpdated' and args->>'policyId' = ${policyId}
        order by block_number, log_index`;
    },

    async blockedAttempts(limit = 100) {
      return sql<BlockedAttempt[]>`select * from blocked_attempts order by at desc limit ${limit}`;
    },

    async insertBlockedAttempt(attempt: { fromAddress: string | null; toAddress: string | null; amount: string | null; reason: string }) {
      const [row] = await sql<BlockedAttempt[]>`insert into blocked_attempts ${sql(attempt)} returning *`;
      return row;
    },

    // Who put a wallet on the policy, or took it off, and in which transaction.
    async insertPolicyChange(change: { wallet: string; allowed: boolean; txHash: string | null; actor: string }) {
      const [row] = await sql<PolicyChange[]>`insert into policy_changes ${sql(change)} returning *`;
      return row;
    },

    async policyChanges(limit = 200) {
      return sql<PolicyChange[]>`select * from policy_changes order by at desc limit ${limit}`;
    },

    async reserveChecks(limit = 20) {
      return sql<ReserveCheck[]>`select * from reserve_checks order by at desc limit ${limit}`;
    },

    // Reais on their way out by Pix whose tBRL has not been burned yet. Between those two
    // moments the supply is legitimately above the balance, and the reserve check has to
    // know it. Only while the withdrawal is still moving: after `staleMinutes` the slack
    // closes, so a stuck withdrawal stops hiding a real shortfall.
    async inFlight(staleMinutes = 5) {
      const [row] = await sql<{ total: string; count: string }[]>`
        select coalesce(sum(amount_brl), 0)::text as total, count(*)::text as count from withdrawals
        where status in ('PIX_ENVIADO', 'PIX_CONFIRMADO', 'QUEIMADO')
          and updated_at > now() - make_interval(mins => ${staleMinutes})`;
      return { brl: BigInt(row?.total ?? '0'), count: Number(row?.count ?? 0) };
    },

    async insertReserveCheck(check: { supply: string; balanceBrl: string; ok: boolean }) {
      const [row] = await sql<ReserveCheck[]>`insert into reserve_checks ${sql(check)} returning *`;
      return row;
    },

    async lastReserveCheck() {
      const [row] = await sql<ReserveCheck[]>`select * from reserve_checks order by at desc limit 1`;
      return row ?? null;
    },

    // The last time the token was paused or unpaused, as the chain recorded it.
    async lastPauseChange() {
      const [row] = await sql<ChainEvent[]>`
        select * from chain_events where event = 'PauseStateUpdate'
        order by block_number desc, log_index desc limit 1`;
      return row ? { at: row.blockTime, paused: row.args.isPaused === true, txHash: row.txHash } : null;
    },

    async setAutoWithdraw(userId: string, on: boolean) {
      const [row] = on
        ? await sql<User[]>`
            update users set auto_withdraw_since = coalesce(auto_withdraw_since, now()) where id = ${userId} returning *`
        : await sql<User[]>`update users set auto_withdraw_since = null where id = ${userId} returning *`;
      return row ?? null;
    },

    // Paid invoices that should go out by Pix on their own: the recipient turned it on
    // before the payment arrived, and nothing was ever withdrawn for them. A withdrawal
    // that failed is not retried by itself; the button is still there.
    async autoWithdrawDue() {
      return sql<{ invoiceId: string; userId: string; brlOut: string }[]>`
        select i.id as invoice_id, i.recipient_id as user_id, q.brl_out
        from invoices i
        join users u on u.id = i.recipient_id
        join quotes q on q.invoice_id = i.id and q.fill_tx is not null
        where i.status = 'paga' and u.auto_withdraw_since is not null and i.paid_at >= u.auto_withdraw_since
          and not exists (select 1 from withdrawals w where w.invoice_id = i.id)
        order by i.paid_at`;
    },

    // false when the address was already on the list
    async joinWaitlist(entry: { email: string; relation: 'recebo' | 'pago' | 'os dois' | null; lang: 'pt' | 'en' }) {
      const rows = await sql`
        insert into waitlist ${sql(entry as Record<string, unknown>)} on conflict (email) do nothing returning id`;
      return rows.length > 0;
    },

    async insertPixEvent(event: NewPixEvent) {
      const inserted = await sql`
        insert into pix_events ${sql({ ...event, payload: sql.json(event.payload as never) } as Record<string, unknown>)}
        on conflict (provider, provider_tx_id, event) do nothing
        returning id`;
      return inserted.length > 0;
    },

    async pixEvents(filter: { reference?: string; providerTxId?: string }) {
      return sql<PixEvent[]>`
        select * from pix_events
        where ${filter.providerTxId ? sql`provider_tx_id = ${filter.providerTxId}` : sql`reference = ${filter.reference ?? ''}`}
        order by received_at, id`;
    },

    async insertOutbox(tx: OutboxTx) {
      await sql`insert into outbox ${sql(tx as unknown as Record<string, unknown>)} on conflict (hash) do nothing`;
    },

    async outbox(hash: string) {
      const [row] = await sql<OutboxTx[]>`select * from outbox where hash = ${hash.toLowerCase()}`;
      return row ?? null;
    },

    // True when `holder` now holds the lease for the next `seconds`.
    async acquireLease(name: string, holder: string, seconds: number) {
      const rows = await sql`
        insert into leases (name, holder, expires_at) values (${name}, ${holder}, now() + make_interval(secs => ${seconds}))
        on conflict (name) do update set holder = excluded.holder, expires_at = excluded.expires_at
          where leases.holder = excluded.holder or leases.expires_at < now()
        returning holder`;
      return rows.length > 0;
    },

    async releaseLease(name: string, holder: string) {
      await sql`delete from leases where name = ${name} and holder = ${holder}`;
    },

    // Everything the demo wrote, cleared in one go for `pnpm demo:reset`. What stays: the
    // people (Ana, the payer and anyone who did the cadastro), the whitelist history, and
    // chain_events with the watcher's cursors, so the console keeps the dates it read from
    // the chain and the watcher doesn't have to read it all again.
    async clearDemo() {
      return sql.begin(async (tx) => {
        const counts: Record<string, number> = {};
        for (const table of [
          'withdrawal_steps',
          'outbox',
          'withdrawals',
          'pix_events',
          'sim_transactions',
          'quotes',
          'invoices',
          'blocked_attempts',
          'reserve_checks',
        ]) {
          const gone = await tx.unsafe(`delete from ${table} returning 1`);
          counts[table] = gone.length;
        }
        await tx`update users set auto_withdraw_since = null`;
        return counts;
      });
    },

    async state(key: string) {
      const [row] = await sql<{ value: string }[]>`select value from worker_state where key = ${key}`;
      return row?.value ?? null;
    },

    async setState(key: string, value: string) {
      await sql`
        insert into worker_state (key, value) values (${key}, ${value})
        on conflict (key) do update set value = excluded.value, updated_at = now()`;
    },
  };
}

export type Queries = ReturnType<typeof queries>;
