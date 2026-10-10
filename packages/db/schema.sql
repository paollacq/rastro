-- Rastro's database. Every statement can run twice, so `pnpm db:migrate` is safe on
-- every deploy; later changes go at the end as `alter table ... add column if not exists`.
-- Token amounts are base units (6 decimals); Pix amounts are reais.

create table if not exists users (
  id text primary key,
  role text not null check (role in ('recebedora', 'pagador')),
  name text not null,
  wallet text not null unique,
  cpf_hash text,
  cpf_masked text,
  pix_key text,
  pix_key_type text,
  pix_key_masked text,
  kyc_status text not null default 'pendente',
  created_at timestamptz not null default now()
);

create table if not exists invoices (
  id text primary key,
  number text not null unique,
  payer_name text not null,
  payer_wallet text not null,
  recipient_id text not null references users (id),
  description text not null,
  amount_usd numeric(18, 2) not null check (amount_usd > 0),
  status text not null default 'aberta' check (status in ('aberta', 'paga')),
  -- Claimed by one payment at a time, so a double click can't pay it twice.
  paying_quote text,
  paying_since timestamptz,
  created_at timestamptz not null default now()
);

create table if not exists quotes (
  id text primary key,
  invoice_id text not null references invoices (id),
  payer text not null,
  recipient text not null,
  ptax_date text not null,
  ptax_rate numeric(12, 4) not null,
  spread_bps integer not null,
  usd_in numeric(78, 0) not null,
  brl_out numeric(78, 0) not null,
  invoice_ref text not null,
  nonce numeric(78, 0) not null unique,
  expiry timestamptz not null,
  signature text not null,
  fill_tx text,
  created_at timestamptz not null default now()
);

-- Everything the watcher saw on tBRL, the RFQ and pathUSD payments into the treasury.
create table if not exists chain_events (
  tx_hash text not null,
  log_index integer not null,
  block_number bigint not null,
  block_time timestamptz,
  contract text not null,
  event text not null,
  from_address text,
  to_address text,
  amount numeric(78, 0),
  memo text,
  memo_text text,
  args jsonb not null,
  primary key (tx_hash, log_index)
);
create index if not exists chain_events_memo_text on chain_events (memo_text);

-- SOLICITADO -> TBRL_NA_TESOURARIA -> PIX_ENVIADO -> PIX_CONFIRMADO -> QUEIMADO -> CONCLUIDO,
-- with FALHOU -> DEVOLVIDO when the Pix doesn't go through, and CANCELADO when the tBRL
-- never left the user's wallet. The id is also the memo of that tBRL transfer.
create table if not exists withdrawals (
  id text primary key,
  user_id text not null references users (id),
  invoice_id text references invoices (id),
  amount_brl numeric(78, 0) not null check (amount_brl > 0),
  status text not null,
  transfer_tx text,
  provider text,
  provider_id text,
  e2e_id text,
  burn_tx text,
  refund_tx text,
  failure text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists withdrawals_open on withdrawals (created_at)
  where status not in ('CONCLUIDO', 'DEVOLVIDO', 'CANCELADO');

create table if not exists withdrawal_steps (
  id bigserial primary key,
  withdrawal_id text not null references withdrawals (id),
  status text not null,
  detail text,
  at timestamptz not null default now()
);

-- Webhooks (and the simulator's stand-in). One row per transaction and event, so a
-- repeated delivery is ignored.
create table if not exists pix_events (
  id bigserial primary key,
  provider text not null,
  provider_tx_id text not null,
  event text not null,
  reference text,
  e2e_id text,
  status text,
  payload jsonb not null,
  signature_ok boolean not null,
  received_at timestamptz not null default now(),
  unique (provider, provider_tx_id, event)
);

create table if not exists sim_transactions (
  id text primary key,
  type text not null check (type in ('DEPOSIT', 'WITHDRAW')),
  reference text not null unique,
  amount_brl numeric(18, 2) not null,
  pix_key text,
  status text not null,
  e2e_id text unique,
  created_at timestamptz not null default now(),
  settles_at timestamptz
);

-- Every transaction the backend signs, saved before it is broadcast. If the broadcast or
-- the process dies, the same bytes are pushed again: one step, one signature, one nonce.
create table if not exists outbox (
  hash text primary key,
  withdrawal_id text references withdrawals (id),
  kind text not null,
  signer text not null,
  nonce bigint not null,
  raw text not null,
  created_at timestamptz not null default now()
);

-- Only one orchestrator moves withdrawals at a time. A lease row works through any
-- connection pooler, unlike a session advisory lock.
create table if not exists leases (
  name text primary key,
  holder text not null,
  expires_at timestamptz not null
);

create table if not exists worker_state (
  key text primary key,
  value text not null,
  updated_at timestamptz not null default now()
);

-- Etapa 4: compliance and reserves.
create table if not exists policy_changes (
  id bigserial primary key,
  wallet text not null,
  allowed boolean not null,
  tx_hash text,
  actor text not null,
  at timestamptz not null default now()
);

create table if not exists blocked_attempts (
  id bigserial primary key,
  from_address text,
  to_address text,
  amount numeric(78, 0),
  reason text not null,
  at timestamptz not null default now()
);

create table if not exists reserve_checks (
  id bigserial primary key,
  supply numeric(78, 0) not null,
  balance_brl numeric(18, 2) not null,
  ok boolean not null,
  at timestamptz not null default now()
);
