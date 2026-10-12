import { explorer, walletView, type ReceivedPayment, type WalletView, type WithdrawalSummary } from '@rastro/core';
import type { Metadata } from 'next';
import Link from 'next/link';
import { Erro } from '../../components/erro';
import { Faixa } from '../../components/faixa';
import { Marca } from '../../components/marca';
import { Money } from '../../components/money';
import { PolicyBadge } from '../../components/policy-badge';
import { TxLink } from '../../components/tx-link';
import { context } from '../../lib/api';
import { percentFromBps, ptaxDay, rate, shortDateTime } from '../../lib/format';
import { currentPixMode, load } from '../../lib/load';
import { STATUS, shortCompany } from '../../lib/words';
import { AutoWithdraw } from './auto-withdraw';
import { WithdrawButton } from './withdraw-button';

export const dynamic = 'force-dynamic';
export const metadata: Metadata = { title: 'Ana Ribeiro' };

const t = {
  balance: 'Balance in tBRL',
  balanceNote: 'Each tBRL is worth one real, with one real in the Pix account behind it.',
  balanceError: "Couldn't read the balance on Tempo right now. Reload in a few seconds.",
  received: 'Payments in',
  receivedEmpty: 'Nothing here yet. When a client pays one of your invoices, the amount shows up here.',
  paid: (payer: string, n: string) => `${payer} paid invoice #${n}`,
  ptax: (day: string, r: string, spread: string) => `PTAX of ${day} (${r}), less ${spread}`,
  trail: 'See the trail',
  sentBy: 'Sent by Pix',
  withdrawals: 'Withdrawals',
  withdrawalsEmpty: 'No withdrawals yet. Each one shows up here with its Pix ID and the trail to the burn.',
  byPix: 'by Pix',
  custody:
    "Demo: this test wallet's key lives on our server, which signs withdrawals for Ana. In a real version she would hold it, in a passkey.",
  loadError: "Couldn't load the wallet. Reload in a few seconds; if it keeps failing, the database or the Tempo node is down.",
  wallet: 'wallet',
};

// Ana's screen: see the money arriving and take it out by Pix.
export default async function AnaPage() {
  const loaded = await load(() => walletView(context(), 'ana'));

  return (
    <div>
      <Faixa lang="en" mode={loaded.ok && loaded.data ? loaded.data.pixMode : currentPixMode()} />
      <main className="pagina">
        <header className="topo">
          <Marca rotulo="rastro, home" />
        </header>
        {!loaded.ok || !loaded.data ? (
          <Erro motivo={loaded.ok ? 'user ana not found: run pnpm db:seed' : loaded.reason}>{t.loadError}</Erro>
        ) : (
          <Wallet view={loaded.data} />
        )}
      </main>
    </div>
  );
}

function Wallet({ view }: { view: WalletView }) {
  const { user } = view;
  return (
    <>
      <section>
        <h1>{user.name}</h1>
        <p style={{ marginTop: 6, display: 'flex', flexWrap: 'wrap', gap: '4px 14px', alignItems: 'baseline' }}>
          <span>
            <span className="sr-only">{t.wallet} </span>
            <TxLink hash={user.wallet} kind="address" explorer={explorer} lang="en" />
          </span>
          {view.policy && <PolicyBadge identified={view.policy.identified} policyId={view.policy.id} lang="en" />}
        </p>
      </section>

      <section className="secao" aria-labelledby="saldo">
        <h2 id="saldo" className="pequeno mudo" style={{ fontWeight: 400, marginBottom: 2 }}>
          {t.balance}
        </h2>
        {view.balance.ok ? (
          <p style={{ fontSize: 'var(--t32)', lineHeight: 1.2 }}>
            <Money value={view.balance.value} currency="BRL" lang="en" />
          </p>
        ) : (
          <Erro motivo={view.balance.error}>{t.balanceError}</Erro>
        )}
        <p className="pequeno mudo" style={{ marginTop: 4 }}>
          {t.balanceNote}
        </p>
        {user.pixKeyMasked && (
          <div style={{ marginTop: 24 }}>
            <AutoWithdraw on={user.autoWithdraw} pixKey={user.pixKeyMasked} />
          </div>
        )}
      </section>

      <section className="secao" aria-labelledby="recebimentos">
        <h2 id="recebimentos">{t.received}</h2>
        {view.payments.length === 0 ? (
          <p className="mudo">{t.receivedEmpty}</p>
        ) : (
          <ul className="linhas">
            {view.payments.map((p) => (
              <Payment key={p.invoiceId} payment={p} pixKey={user.pixKeyMasked} />
            ))}
          </ul>
        )}
      </section>

      <section className="secao" aria-labelledby="saques">
        <h2 id="saques">{t.withdrawals}</h2>
        {view.withdrawals.length === 0 ? (
          <p className="mudo">{t.withdrawalsEmpty}</p>
        ) : (
          <ul className="linhas">
            {view.withdrawals.map((w) => (
              <Withdrawal key={w.id} w={w} />
            ))}
          </ul>
        )}
      </section>

      <p className="rodape">{t.custody}</p>
    </>
  );
}

function Payment({ payment: p, pixKey }: { payment: ReceivedPayment; pixKey: string | null }) {
  return (
    <li>
      <p className="linha-valor">
        <strong>{t.paid(shortCompany(p.payerName), p.number)}</strong>
        <span className="quando mono pequeno mudo" suppressHydrationWarning>
          {shortDateTime(p.paidAt, 'en')}
        </span>
      </p>
      <p style={{ marginTop: 2 }}>
        <Money value={p.amountUsd} currency="USD" lang="en" />
        <svg width="22" height="10" viewBox="0 0 22 10" aria-hidden="true" style={{ margin: '0 8px', verticalAlign: '0.05em' }}>
          <path d="M1 5h19M16 1.5 20 5l-4 3.5" fill="none" stroke="var(--grafite)" strokeWidth="1.2" />
        </svg>
        <span className="sr-only">became </span>
        <Money value={p.brlOut} currency="BRL" lang="en" /> in tBRL
      </p>
      <p className="pequeno mudo" style={{ marginTop: 2 }}>
        {t.ptax(ptaxDay(p.ptaxDate, 'en'), rate(p.ptaxRate, 'en'), percentFromBps(p.spreadBps, 'en'))}
        {' · '}
        <Link href={`/trace/${p.invoiceId}`}>{t.trail}</Link>
      </p>
      {p.withdrawable ? (
        <div style={{ marginTop: 14 }}>
          <WithdrawButton amountBrl={p.withdrawable} invoiceId={p.invoiceId} pixKey={pixKey} />
        </div>
      ) : p.withdrawal ? (
        <p className="pequeno" style={{ marginTop: 8 }}>
          {t.sentBy}: <Money value={p.withdrawal.amountBrl} currency="BRL" lang="en" />, {STATUS.en[p.withdrawal.status].toLowerCase()}
        </p>
      ) : null}
    </li>
  );
}

function Withdrawal({ w }: { w: WithdrawalSummary }) {
  const failed = w.status === 'FALHOU' || w.status === 'DEVOLVIDO' || w.status === 'CANCELADO';
  return (
    <li>
      <p className="linha-valor">
        <span>
          <Money value={w.amountBrl} currency="BRL" lang="en" /> {t.byPix}
          <span className={failed ? 'pequeno' : 'pequeno mudo'} style={{ marginLeft: 10, color: failed ? 'var(--recusa)' : undefined }}>
            {STATUS.en[w.status]}
          </span>
        </span>
        <span className="quando mono pequeno mudo" suppressHydrationWarning>
          {shortDateTime(w.createdAt, 'en')}
        </span>
      </p>
      <p className="pequeno mudo" style={{ marginTop: 2, overflowWrap: 'anywhere' }}>
        {w.e2eId && <span className="mono">{w.e2eId}</span>}
        {w.e2eId && ' · '}
        {failed && w.failure && <span>{w.failure} · </span>}
        <Link href={`/trace/${w.id}`}>{t.trail}</Link>
      </p>
    </li>
  );
}
