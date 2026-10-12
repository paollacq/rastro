'use client';

import type { Trace } from '@rastro/core';
import { trailOf, type Trail, type TrailStep } from '@rastro/core/trail';
import Link from 'next/link';
import { useEffect, useMemo, useState, type ReactNode } from 'react';
import { Comprovante } from '../../../components/comprovante';
import { Comparacao } from '../../../components/id-block';
import { Money } from '../../../components/money';
import { Trilha, type TrilhaItem } from '../../../components/trilha';
import { TxLink } from '../../../components/tx-link';
import { clock, dateTime, money, percentFromBps, ptaxDay, rate, stamp } from '../../../lib/format';
import { STATUS, shortCompany } from '../../../lib/words';

// The trail page asks /api/trace/:id every second while a step is still open, and stops when
// nothing is left to happen. It pauses while the tab is hidden.

const POLL_MS = 1_000;

export function TraceView({ id, initial }: { id: string; initial: Trace }) {
  const [trace, setTrace] = useState(initial);
  const [checkedAt, setCheckedAt] = useState<string | null>(null);
  const [problem, setProblem] = useState<string | null>(null);
  const trail = useMemo(() => trailOf(trace), [trace]);

  useEffect(() => {
    if (trail.settled) return;
    let timer: ReturnType<typeof setTimeout>;
    let stopped = false;
    const poll = async () => {
      if (document.visibilityState === 'visible') {
        try {
          const res = await fetch(`/api/trace/${encodeURIComponent(id)}`, { cache: 'no-store' });
          const body = await res.json();
          if (!res.ok) throw new Error(body.error ?? String(res.status));
          if (!stopped) {
            setTrace(body as Trace);
            setCheckedAt(new Date().toISOString());
            setProblem(null);
          }
        } catch (error) {
          if (!stopped) setProblem(error instanceof Error ? error.message : String(error));
        }
      }
      if (!stopped) timer = setTimeout(poll, POLL_MS);
    };
    timer = setTimeout(poll, POLL_MS);
    return () => {
      stopped = true;
      clearTimeout(timer);
    };
  }, [id, trail.settled]);

  const { invoice } = trace;
  const recipient = invoice?.recipientName ?? 'Ana';
  const firstName = recipient.split(' ')[0];
  const last = [...trail.steps].reverse().find((step) => step.at)?.at ?? null;

  return (
    <>
      <section style={{ marginBottom: 28 }}>
        <h1>{invoice ? `Invoice #${invoice.number}` : `Withdrawal ${trail.withdrawal ? money(trail.withdrawal.amountBrl, 'BRL', 'en') : ''}`}</h1>
        <p className="mudo" style={{ marginTop: 4 }}>
          {invoice ? (
            <>
              {shortCompany(invoice.payerName)} to {recipient} · <Money value={invoice.amountUsd} currency="USD" lang="en" />
            </>
          ) : (
            <>From {firstName} by Pix, no invoice behind it</>
          )}
        </p>
        <p className="pequeno mudo" style={{ marginTop: 8, minHeight: '1.5em' }}>
          {problem ? (
            <span style={{ color: 'var(--recusa)' }}>No response from the server right now ({problem}); retrying.</span>
          ) : trail.settled ? null : (
            <span suppressHydrationWarning>
              Following live{checkedAt ? `, updated at ${clock(checkedAt, 'en')}` : ''}
            </span>
          )}
        </p>
      </section>

      {/* Read out only when a step changes, not on every poll. */}
      <p className="sr-only" aria-live="polite">
        {announce(trail)}
      </p>

      <Comprovante esquerda={<span className="mono">{trail.withdrawal && !invoice ? trail.withdrawal.id : (invoice?.id ?? id)}</span>} direita={last ? <span className="mono" suppressHydrationWarning>{dateTime(last, 'en')}</span> : null}>
        <Trilha items={items(trace, trail, firstName)} lang="en" />
        {trail.comparison && (
          <>
            <hr className="tracejado" style={{ margin: '28px 0 18px' }} />
            <Comparacao comparison={trail.comparison} explorer={trace.explorer} />
          </>
        )}
      </Comprovante>

      {trail.others.length > 0 && (
        <section className="secao">
          <h2>Other withdrawals from this invoice</h2>
          <ul className="linhas">
            {trail.others.map((w) => (
              <li key={w.id} className="linha-valor">
                <span>
                  <Money value={w.amountBrl} currency="BRL" lang="en" /> <span className="mudo pequeno">{STATUS.en[w.status]}</span>
                </span>
                <Link href={`/trace/${w.id}`}>See trail</Link>
              </li>
            ))}
          </ul>
        </section>
      )}
    </>
  );
}

const SPOKEN: Record<TrailStep['key'], string> = {
  emitida: 'invoice issued',
  paga: 'paid in dollars on Tempo',
  convertida: 'converted to reais',
  carteira: 'in the identified wallet',
  pix: 'Pix sent',
  queima: 'burned on Tempo with the same ID',
  devolvida: 'returned to the wallet',
};

function announce(trail: Trail) {
  const step = [...trail.steps].reverse().find((s) => s.state !== 'esperando');
  if (!step) return '';
  const state = { feito: 'done', agora: 'in progress', falhou: "didn't happen", esperando: '' }[step.state];
  const stamped = trail.comparison?.matches ? ` Verified: ${trail.comparison.length} of ${trail.comparison.length} characters match.` : '';
  return `${SPOKEN[step.key]}: ${state}.${stamped}`;
}

function items(trace: Trace, trail: Trail, firstName: string): TrilhaItem[] {
  const { invoice, quote, explorer } = trace;
  const w = trail.withdrawal;
  const wallet = trace.payment.find((event) => event.event === 'Filled')?.toAddress ?? null;
  const tx = (hash: string | null) => (hash ? <TxLink hash={hash} explorer={explorer} lang="en" /> : null);
  const when = (step: TrailStep) => (step.at ? stamp(step.at, 'en') : null);

  return trail.steps.map((step): TrilhaItem => {
    const base = { key: step.key, state: step.state, time: when(step) };
    switch (step.key) {
      case 'emitida':
        return {
          ...base,
          title: `Invoice #${invoice?.number} issued`,
          detail: invoice && (
            <span className="mudo">
              <Money value={invoice.amountUsd} currency="USD" lang="en" /> · {invoice.description}
            </span>
          ),
        };
      case 'paga':
        return {
          ...base,
          title: 'Paid in dollars on Tempo',
          detail:
            step.state === 'feito' ? (
              <span className="mudo">
                {invoice && <Money value={invoice.amountUsd} currency="USD" lang="en" />} in pathUSD · {tx(step.tx)}
              </span>
            ) : (
              <span className="mudo">Waiting for {invoice ? shortCompany(invoice.payerName) : 'the payer'} to pay</span>
            ),
        };
      case 'convertida':
        return step.state === 'feito' && quote
          ? {
              ...base,
              title: `Converted to ${money(quote.brlOut, 'BRL', 'en')}, PTAX less ${percentFromBps(quote.spreadBps, 'en')}`,
              detail: (
                <span className="mudo">
                  PTAX of {ptaxDay(quote.ptaxDate, 'en')}: {rate(quote.ptaxRate, 'en')}, from the Central Bank of Brazil
                </span>
              ),
            }
          : { ...base, title: 'Converted to reais' };
      case 'carteira':
        return {
          ...base,
          title: `In ${firstName === 'Ana' ? "Ana's" : `${firstName}'s`} identified wallet`,
          detail:
            step.state === 'feito' && wallet ? (
              <span className="mudo">
                tBRL in wallet <TxLink hash={wallet} kind="address" explorer={explorer} lang="en" />, which is on the TIP-403
                policy list
              </span>
            ) : null,
        };
      case 'pix':
        return { ...base, title: 'Pix sent', detail: pixDetail(step, w, tx) };
      case 'queima':
        return {
          ...base,
          title: 'Burned on Tempo with the same ID',
          detail:
            step.state === 'feito' ? (
              <span className="mudo">
                {w && <Money value={w.amountBrl} currency="BRL" lang="en" />} of tBRL out of circulation · {tx(step.tx)}
              </span>
            ) : step.state === 'agora' ? (
              <span className="passo__estado">Burning the tBRL with the Pix ID in the memo</span>
            ) : null,
        };
      case 'devolvida':
        return {
          ...base,
          title: `Returned to ${firstName === 'Ana' ? "Ana's" : `${firstName}'s`} wallet`,
          detail:
            step.state === 'feito' ? (
              <span className="mudo">
                {w && <Money value={w.amountBrl} currency="BRL" lang="en" />} of tBRL back · {tx(step.tx)}
              </span>
            ) : (
              <span className="passo__estado">Returning the tBRL</span>
            ),
        };
    }
  });
}

function pixDetail(step: TrailStep, w: Trail['withdrawal'], tx: (hash: string | null) => ReactNode): ReactNode {
  if (!w) return <span className="mudo">Waiting for the withdrawal</span>;
  const key = w.pixKeyMasked ? ` to ${w.pixKeyMasked}` : '';
  const amount = <Money value={w.amountBrl} currency="BRL" lang="en" />;
  switch (w.status) {
    case 'SOLICITADO':
      return (
        <span className="passo__estado">
          Withdrawal of {amount} requested; the tBRL is on its way to the treasury {tx(step.tx)}
        </span>
      );
    case 'TBRL_NA_TESOURARIA':
      return <span className="passo__estado">tBRL at the treasury; requesting the Pix{key}</span>;
    case 'PIX_ENVIADO':
      return (
        <span className="passo__estado">
          Pix of {amount} on its way{key}
          {w.provider === 'payzu-sandbox' && Number(w.amountBrl) > 100 ? '; the sandbox holds amounts above R$ 100 for about 10 s' : ''}
        </span>
      );
    case 'FALHOU':
    case 'DEVOLVIDO':
      return <span style={{ color: 'var(--recusa)' }}>Pix refused{w.failure ? `: ${w.failure}` : ''}</span>;
    case 'CANCELADO':
      return <span style={{ color: 'var(--recusa)' }}>Withdrawal cancelled: the tBRL didn&apos;t leave the wallet{w.failure ? ` (${w.failure})` : ''}</span>;
    default:
      return (
        <span className="mudo">
          ID <span className="mono" style={{ color: 'var(--tinta)' }}>{w.e2eId}</span>
          {w.provider === 'simulator' ? ' (simulated)' : w.e2eFormat === 'sandbox' ? ' (sandbox)' : ''}, {amount}
          {key}
          <span style={{ display: 'block' }}>First, the tBRL went to the treasury: {tx(step.tx)}</span>
        </span>
      );
  }
}
