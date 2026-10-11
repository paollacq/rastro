import {
  allowlistView,
  blockedView,
  explorer,
  operationsView,
  reservesView,
  type AllowlistView,
  type BlockedView,
  type OperationRow,
  type ReservesView,
  effectivePixMode,
} from '@rastro/core';
import type { Metadata } from 'next';
import Link from 'next/link';
import { Erro } from '../../components/erro';
import { Faixa } from '../../components/faixa';
import { Marca } from '../../components/marca';
import { PolicyBadge } from '../../components/policy-badge';
import { ReserveGauge } from '../../components/reserve-gauge';
import { TxLink } from '../../components/tx-link';
import { context } from '../../lib/api';
import { amount, dateTime, money, percentFromBps, rate, shortDateTime, timeOnly } from '../../lib/format';
import { currentPixMode, load } from '../../lib/load';
import { STATUS } from '../../lib/words';

export const dynamic = 'force-dynamic';
export const metadata: Metadata = { title: 'Console' };

const TABS = [
  { id: 'operations', label: 'Operations' },
  { id: 'allowlist', label: 'Allowlist' },
  { id: 'blocked', label: 'Blocked' },
  { id: 'reserves', label: 'Reserves' },
] as const;
type Tab = (typeof TABS)[number]['id'];

// The institution's console, in English, with the Brazilian regulatory terms left in
// Portuguese. Its job: show a broker it stays square with the Central Bank without a
// spreadsheet. Each tab reads only what it shows.
export default async function ConsolePage({ searchParams }: { searchParams: Promise<{ tab?: string }> }) {
  const asked = (await searchParams).tab;
  const tab: Tab = TABS.some((t) => t.id === asked) ? (asked as Tab) : 'operations';
  const mode = await load(() => effectivePixMode(context()));

  return (
    <div lang="en">
      <Faixa lang="en" mode={mode.ok ? mode.data : currentPixMode()} />
      <main className="pagina pagina--larga">
        <header className="topo">
          <Marca rotulo="rastro, home" />
          <p className="topo__lado">
            <span>Corretora parceira (demo)</span>
            <span>Compliance console</span>
          </p>
        </header>

        <nav className="abas" aria-label="Console sections">
          {TABS.map((t) => (
            <Link key={t.id} href={t.id === 'operations' ? '/console' : `/console?tab=${t.id}`} aria-current={t.id === tab ? 'page' : undefined}>
              {t.label}
            </Link>
          ))}
        </nav>

        {tab === 'operations' && <Operations />}
        {tab === 'allowlist' && <Allowlist />}
        {tab === 'blocked' && <Blocked />}
        {tab === 'reserves' && <Reserves />}
      </main>
    </div>
  );
}

function LoadError({ reason }: { reason: string }) {
  return (
    <Erro motivo={reason}>
      This section didn&apos;t load. Reload in a few seconds; if it keeps failing, the database or the Tempo node is down.
    </Erro>
  );
}

async function Operations() {
  const loaded = await load(() => operationsView(context()));
  if (!loaded.ok) return <LoadError reason={loaded.reason} />;
  const rows = loaded.data;
  return (
    <section aria-labelledby="ops">
      <div className="linha-valor" style={{ alignItems: 'center', marginBottom: 16, flexWrap: 'wrap' }}>
        <h1 id="ops" style={{ fontSize: 'var(--t18)' }}>
          {rows.length === 1 ? '1 operation' : `${rows.length} operations`}
        </h1>
        <a className="botao botao--secundario" href="/api/report.csv" download>
          Export report (CSV)
        </a>
      </div>
      {rows.length === 0 ? (
        <p className="mudo">
          No operations yet. Each paid invoice shows up here as a conversion, with the Pix that took it out.
        </p>
      ) : (
        <div className="tabela-rolagem">
          <table className="tabela">
            <thead>
              <tr>
                <th scope="col">Time (Brasília)</th>
                <th scope="col">Client</th>
                <th scope="col">Wallet</th>
                <th scope="col" className="num">
                  USD
                </th>
                <th scope="col" className="num">
                  Rate
                </th>
                <th scope="col" className="num">
                  BRL
                </th>
                <th scope="col">Pix ID</th>
                <th scope="col">Tempo tx</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((op) => (
                <OperationLine key={`${op.kind}-${op.invoice?.id ?? op.withdrawal?.id}`} op={op} />
              ))}
            </tbody>
          </table>
        </div>
      )}
      <p className="pequeno mudo" style={{ marginTop: 14, maxWidth: 640 }}>
        Fields cover the origin and destination data BCB Res. 521 asks for. This is not the official filing layout.
      </p>
    </section>
  );
}

function OperationLine({ op }: { op: OperationRow }) {
  const w = op.withdrawal;
  const brl = op.brl ?? w?.amountBrl ?? null;
  return (
    <tr>
      <td className="mono" style={{ whiteSpace: 'nowrap' }}>
        {shortDateTime(op.at, 'en')}
      </td>
      <td style={{ maxWidth: 230 }}>
        {op.client.name}
        <span className="mudo" style={{ display: 'block' }}>
          {op.client.cpfMasked ? `CPF ${op.client.cpfMasked}` : 'CPF not on file yet'}
        </span>
        {op.invoice && (
          <span className="mudo" style={{ display: 'block' }}>
            Invoice #{op.invoice.number}, paid by {op.invoice.payerName?.replace(/,? Inc\.?$/, '')}
          </span>
        )}
      </td>
      <td>
        <TxLink hash={op.client.wallet} kind="address" explorer={explorer} lang="en" />
      </td>
      <td className="num">{op.usd ? amount(op.usd, 'en') : <span className="mudo">tBRL held</span>}</td>
      <td className="num" title={op.ptax ? `PTAX ${op.ptax.rate} of ${op.ptax.date}, less ${percentFromBps(op.ptax.spreadBps, 'en')}` : undefined}>
        {op.rate ? (
          <>
            {rate(op.rate, 'en')}
            {op.ptax && (
              <span className="mudo" style={{ display: 'block' }}>
                PTAX {rate(op.ptax.rate, 'en')}
              </span>
            )}
          </>
        ) : (
          <span className="mudo">–</span>
        )}
      </td>
      <td className="num">{brl ? amount(brl, 'en') : '–'}</td>
      <td>
        {w?.e2eId ? (
          <span className="mono" style={{ whiteSpace: 'nowrap' }}>
            {w.e2eId}
          </span>
        ) : (
          <span className="mudo">{w ? STATUS.en[w.status] : 'not withdrawn yet'}</span>
        )}
        {w?.e2eId && (
          <span className="mudo" style={{ display: 'block' }}>
            {w.provider === 'simulator' ? 'simulated' : w.provider === 'payzu-sandbox' ? 'PayZu sandbox' : w.provider}
            {w.status !== 'CONCLUIDO' ? `, ${STATUS.en[w.status].toLowerCase()}` : ''}
          </span>
        )}
      </td>
      <td style={{ whiteSpace: 'nowrap' }}>
        {op.fillTx && (
          <span style={{ display: 'block' }}>
            <span className="mudo">fill </span>
            <TxLink hash={op.fillTx} explorer={explorer} lang="en" />
          </span>
        )}
        {op.burnTx && (
          <span style={{ display: 'block' }}>
            <span className="mudo">burn </span>
            <TxLink hash={op.burnTx} explorer={explorer} lang="en" />
          </span>
        )}
        {!op.fillTx && !op.burnTx && op.transferTx && (
          <span style={{ display: 'block' }}>
            <span className="mudo">transfer </span>
            <TxLink hash={op.transferTx} explorer={explorer} lang="en" />
          </span>
        )}
      </td>
    </tr>
  );
}

const HOLDER: Record<AllowlistView['entries'][number]['holder']['kind'], string> = {
  tesouraria: 'Treasury (tesouraria): mints, burns and takes withdrawals in',
  rfq: 'RastroRFQ contract: holds the tBRL stock and pays it out on each fill',
  cliente: 'client',
  outro: 'Not one of ours',
};

async function Allowlist() {
  const loaded = await load(() => allowlistView(context()));
  if (!loaded.ok) return <LoadError reason={loaded.reason} />;
  const { policyId, entries } = loaded.data;
  if (!policyId) {
    return <p className="mudo">No TIP-403 policy in deployments/moderato.json yet. Run pnpm chain:setup.</p>;
  }
  return (
    <section aria-labelledby="allow">
      <div className="linha-valor" style={{ alignItems: 'center', marginBottom: 4, flexWrap: 'wrap' }}>
        <h1 id="allow" style={{ fontSize: 'var(--t18)' }}>
          Policy {policyId}: identified wallets
        </h1>
        <Link className="botao botao--secundario" href="/cadastro">
          Add a client
        </Link>
      </div>
      <p className="mudo" style={{ marginTop: 4, marginBottom: 16, maxWidth: 680 }}>
        A whitelist on Tempo&apos;s TIP-403 registry. tBRL only moves between wallets on it: the chain refuses any other
        transfer before it happens. A client gets on it after the cadastro (CPF checked, chave Pix on file).
      </p>
      <div className="tabela-rolagem">
        <table className="tabela">
          <thead>
            <tr>
              <th scope="col">Wallet</th>
              <th scope="col">Holder</th>
              <th scope="col">Status, read now</th>
              <th scope="col">On the list since</th>
              <th scope="col">Tempo tx</th>
            </tr>
          </thead>
          <tbody>
            {entries.map((e) => (
              <tr key={e.wallet}>
                <td>
                  <TxLink hash={e.wallet} kind="address" explorer={explorer} lang="en" />
                </td>
                <td>
                  {e.holder.kind === 'cliente' ? `${e.holder.name}, client` : HOLDER[e.holder.kind]}
                  {e.by && (
                    <span className="mudo" style={{ display: 'block' }}>
                      added by {e.by}
                    </span>
                  )}
                </td>
                <td>
                  <PolicyBadge identified={e.identified} policyId={policyId} lang="en" />
                </td>
                <td className="mono">{e.since ? dateTime(e.since, 'en') : <span className="mudo">at the policy&apos;s creation</span>}</td>
                <td>{e.tx ? <TxLink hash={e.tx} explorer={explorer} lang="en" /> : <span className="mudo">–</span>}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}

async function Blocked() {
  const loaded = await load(() => blockedView(context()));
  if (!loaded.ok) return <LoadError reason={loaded.reason} />;
  const { attempts, policyId } = loaded.data as BlockedView;
  return (
    <section aria-labelledby="blocked">
      <h1 id="blocked" style={{ fontSize: 'var(--t18)', marginBottom: 12 }}>
        Transfers the policy refused
      </h1>
      {attempts.length === 0 ? (
        <p className="mudo" style={{ maxWidth: 640 }}>
          Nothing blocked yet. When a transfer of tBRL to a wallet outside policy {policyId ?? ''} is refused on-chain, it
          shows up here with the reason.
        </p>
      ) : (
        <ul className="linhas">
          {attempts.map((a, i) => (
            <li key={`${a.at}-${i}`} className="linha-valor" style={{ alignItems: 'flex-start' }}>
              <span>
                <span style={{ color: 'var(--recusa)', fontWeight: 600 }}>
                  Transfer to <span className="mono">{a.to ? `${a.to.slice(0, 4)}…${a.to.slice(-2)}` : 'an unknown wallet'}</span> blocked:
                </span>{' '}
                {a.reason}
                {a.amountBrl && (
                  <span className="mudo" style={{ display: 'block' }}>
                    {money(a.amountBrl, 'BRL', 'en')}
                    {a.from ? ` from ${a.from.slice(0, 6)}…${a.from.slice(-4)}` : ''}
                  </span>
                )}
              </span>
              <span className="quando mono pequeno mudo">{shortDateTime(a.at, 'en')}</span>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

async function Reserves() {
  const loaded = await load(() => reservesView(context()));
  if (!loaded.ok) return <LoadError reason={loaded.reason} />;
  const r: ReservesView = loaded.data;
  const source = r.provider === 'simulator' ? 'the Pix simulator' : 'the PayZu sandbox account';
  return (
    <section aria-labelledby="reserves">
      <h1 id="reserves" style={{ fontSize: 'var(--t18)' }}>
        Backing (lastro)
      </h1>
      <p className="mudo" style={{ marginTop: 4, marginBottom: 20, maxWidth: 640 }}>
        The rule: tBRL in circulation never goes over the reais in {source}. Read live, on every load.
      </p>
      {!r.supply.ok || !r.balance.ok ? (
        <Erro motivo={!r.supply.ok ? r.supply.error : !r.balance.ok ? r.balance.error : null}>
          {!r.supply.ok
            ? "Couldn't read the tBRL supply on Tempo, so the check can't run. Reload in a few seconds."
            : r.provider === 'payzu-sandbox'
              ? "Couldn't read the PayZu sandbox balance. Its credential lasts 24 h: get a new one, or switch to PIX_MODE=simulator."
              : "Couldn't read the simulator's balance from the database."}
        </Erro>
      ) : (
        <>
          <ReserveGauge supply={r.supply.value} balance={r.balance.value} inFlight={r.inFlight} lang="en" />
          <p style={{ marginTop: 20, fontWeight: 600, color: r.shortfall === '0.00' ? 'var(--conferido)' : 'var(--recusa)' }}>
            {r.shortfall === '0.00'
              ? 'Match. Every tBRL in circulation has a real behind it.'
              : `Supply exceeds BRL in account by ${money(r.shortfall ?? '0', 'BRL', 'en')}.`}
            {r.paused.ok && r.paused.value && r.pausedAt && ` Minting paused at ${timeOnly(r.pausedAt)}.`}
          </p>
        </>
      )}
      {r.paused.ok && (
        <p className="mudo" style={{ marginTop: 6 }}>
          {r.paused.value ? (
            <>
              tBRL is paused on-chain: no transfers, mints or burns until it is unpaused.
              {r.pauseTx && (
                <>
                  {' '}
                  <TxLink hash={r.pauseTx} explorer={explorer} lang="en" />
                </>
              )}
            </>
          ) : (
            'tBRL is not paused.'
          )}
        </p>
      )}
      {r.checks.length > 0 && (
        <div className="secao">
          <h2>Last checks</h2>
          <div className="tabela-rolagem tabela--curta" style={{ marginTop: 8 }}>
            <table className="tabela">
              <thead>
                <tr>
                  <th scope="col">Time (Brasília)</th>
                  <th scope="col" className="num">
                    tBRL supply
                  </th>
                  <th scope="col" className="num">
                    BRL in account
                  </th>
                  <th scope="col">Result</th>
                </tr>
              </thead>
              <tbody>
                {r.checks.map((c) => (
                  <tr key={c.at}>
                    <td className="mono">{shortDateTime(c.at, 'en')}</td>
                    <td className="num">{amount(c.supply, 'en')}</td>
                    <td className="num">{amount(c.balanceBrl, 'en')}</td>
                    <td style={{ color: c.ok ? 'var(--conferido)' : 'var(--recusa)' }}>{c.ok ? 'Match' : 'Short'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
      {r.balance.ok && (
        <p className="pequeno mudo" style={{ marginTop: 24 }}>
          Balance read from {source}
          {r.provider === 'payzu-sandbox' ? ' (GET /v1/user/balance)' : ''}; supply from tBRL&apos;s totalSupply() on Tempo.
        </p>
      )}
    </section>
  );
}
