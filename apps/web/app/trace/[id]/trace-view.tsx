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
// nothing is left to happen (spec, "Tempo real"). It pauses while the tab is hidden.

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
        <h1>{invoice ? `Fatura #${invoice.number}` : `Saque ${trail.withdrawal ? money(trail.withdrawal.amountBrl, 'BRL', 'pt') : ''}`}</h1>
        <p className="mudo" style={{ marginTop: 4 }}>
          {invoice ? (
            <>
              {shortCompany(invoice.payerName)} para {recipient} · <Money value={invoice.amountUsd} currency="USD" lang="pt" />
            </>
          ) : (
            <>De {firstName} por Pix, sem fatura por trás</>
          )}
        </p>
        <p className="pequeno mudo" style={{ marginTop: 8, minHeight: '1.5em' }}>
          {problem ? (
            <span style={{ color: 'var(--recusa)' }}>Sem resposta do servidor agora ({problem}); tentando de novo.</span>
          ) : trail.settled ? null : (
            <span suppressHydrationWarning>
              Acompanhando ao vivo{checkedAt ? `, atualizado às ${clock(checkedAt, 'pt')}` : ''}
            </span>
          )}
        </p>
      </section>

      {/* Read out only when a step changes, not on every poll. */}
      <p className="sr-only" aria-live="polite">
        {announce(trail)}
      </p>

      <Comprovante esquerda={<span className="mono">{trail.withdrawal && !invoice ? trail.withdrawal.id : (invoice?.id ?? id)}</span>} direita={last ? <span className="mono" suppressHydrationWarning>{dateTime(last, 'pt')}</span> : null}>
        <Trilha items={items(trace, trail, firstName)} />
        {trail.comparison && (
          <>
            <hr className="tracejado" style={{ margin: '28px 0 18px' }} />
            <Comparacao comparison={trail.comparison} explorer={trace.explorer} />
          </>
        )}
      </Comprovante>

      {trail.others.length > 0 && (
        <section className="secao">
          <h2>Outros saques desta fatura</h2>
          <ul className="linhas">
            {trail.others.map((w) => (
              <li key={w.id} className="linha-valor">
                <span>
                  <Money value={w.amountBrl} currency="BRL" lang="pt" /> <span className="mudo pequeno">{STATUS.pt[w.status]}</span>
                </span>
                <Link href={`/trace/${w.id}`}>Ver rastro</Link>
              </li>
            ))}
          </ul>
        </section>
      )}
    </>
  );
}

const SPOKEN: Record<TrailStep['key'], string> = {
  emitida: 'fatura emitida',
  paga: 'pago em dólar no Tempo',
  convertida: 'convertido em reais',
  carteira: 'na carteira identificada',
  pix: 'Pix enviado',
  queima: 'queimado no Tempo com o mesmo ID',
  devolvida: 'devolvido à carteira',
};

function announce(trail: Trail) {
  const step = [...trail.steps].reverse().find((s) => s.state !== 'esperando');
  if (!step) return '';
  const state = { feito: 'concluído', agora: 'em andamento', falhou: 'não aconteceu', esperando: '' }[step.state];
  const stamped = trail.comparison?.matches ? ` Conferido: ${trail.comparison.length} de ${trail.comparison.length} caracteres iguais.` : '';
  return `${SPOKEN[step.key]}: ${state}.${stamped}`;
}

function items(trace: Trace, trail: Trail, firstName: string): TrilhaItem[] {
  const { invoice, quote, explorer } = trace;
  const w = trail.withdrawal;
  const wallet = trace.payment.find((event) => event.event === 'Filled')?.toAddress ?? null;
  const tx = (hash: string | null) => (hash ? <TxLink hash={hash} explorer={explorer} lang="pt" /> : null);
  const when = (step: TrailStep) => (step.at ? stamp(step.at, 'pt') : null);

  return trail.steps.map((step): TrilhaItem => {
    const base = { key: step.key, state: step.state, time: when(step) };
    switch (step.key) {
      case 'emitida':
        return {
          ...base,
          title: `Fatura #${invoice?.number} emitida`,
          translation: `Invoice #${invoice?.number} issued`,
          detail: invoice && (
            <span className="mudo">
              <Money value={invoice.amountUsd} currency="USD" lang="pt" /> · {invoice.description}
            </span>
          ),
        };
      case 'paga':
        return {
          ...base,
          title: 'Pago em dólar no Tempo',
          translation: 'Paid in dollars on Tempo',
          detail:
            step.state === 'feito' ? (
              <span className="mudo">
                {invoice && <Money value={invoice.amountUsd} currency="USD" lang="pt" />} em pathUSD · {tx(step.tx)}
              </span>
            ) : (
              <span className="mudo">Esperando {invoice ? shortCompany(invoice.payerName) : 'o pagador'} pagar</span>
            ),
        };
      case 'convertida':
        return step.state === 'feito' && quote
          ? {
              ...base,
              title: `Convertido em ${money(quote.brlOut, 'BRL', 'pt')}, PTAX menos ${percentFromBps(quote.spreadBps, 'pt')}`,
              translation: `Converted to ${money(quote.brlOut, 'BRL', 'en')}`,
              detail: (
                <span className="mudo">
                  PTAX de {ptaxDay(quote.ptaxDate, 'pt')}: {rate(quote.ptaxRate, 'pt')}, do Banco Central
                </span>
              ),
            }
          : { ...base, title: 'Convertido em reais', translation: 'Converted to reais' };
      case 'carteira':
        return {
          ...base,
          title: `Na carteira identificada ${firstName === 'Ana' ? 'da Ana' : `de ${firstName}`}`,
          translation: `In ${firstName}'s identified wallet`,
          detail:
            step.state === 'feito' && wallet ? (
              <span className="mudo">
                tBRL na carteira <TxLink hash={wallet} kind="address" explorer={explorer} lang="pt" />, que está na lista da
                política TIP-403
              </span>
            ) : null,
        };
      case 'pix':
        return { ...base, title: 'Pix enviado', translation: 'Pix sent', detail: pixDetail(step, w, tx) };
      case 'queima':
        return {
          ...base,
          title: 'Queimado no Tempo com o mesmo ID',
          translation: 'Burned on Tempo with the same ID',
          detail:
            step.state === 'feito' ? (
              <span className="mudo">
                {w && <Money value={w.amountBrl} currency="BRL" lang="pt" />} em tBRL saíram de circulação · {tx(step.tx)}
              </span>
            ) : step.state === 'agora' ? (
              <span className="passo__estado">Queimando o tBRL com o ID do Pix no memo</span>
            ) : null,
        };
      case 'devolvida':
        return {
          ...base,
          title: `Devolvido à carteira ${firstName === 'Ana' ? 'da Ana' : `de ${firstName}`}`,
          translation: `Returned to ${firstName}'s wallet`,
          detail:
            step.state === 'feito' ? (
              <span className="mudo">
                {w && <Money value={w.amountBrl} currency="BRL" lang="pt" />} em tBRL de volta · {tx(step.tx)}
              </span>
            ) : (
              <span className="passo__estado">Devolvendo o tBRL</span>
            ),
        };
    }
  });
}

function pixDetail(step: TrailStep, w: Trail['withdrawal'], tx: (hash: string | null) => ReactNode): ReactNode {
  if (!w) return <span className="mudo">Esperando o saque</span>;
  const key = w.pixKeyMasked ? ` para ${w.pixKeyMasked}` : '';
  const amount = <Money value={w.amountBrl} currency="BRL" lang="pt" />;
  switch (w.status) {
    case 'SOLICITADO':
      return (
        <span className="passo__estado">
          Saque de {amount} pedido; o tBRL está indo para a tesouraria {tx(step.tx)}
        </span>
      );
    case 'TBRL_NA_TESOURARIA':
      return <span className="passo__estado">tBRL na tesouraria; pedindo o Pix{key}</span>;
    case 'PIX_ENVIADO':
      return (
        <span className="passo__estado">
          Pix de {amount} a caminho{key}
          {w.provider === 'payzu-sandbox' && Number(w.amountBrl) > 100 ? '; o sandbox segura valores acima de R$ 100 por uns 10 s' : ''}
        </span>
      );
    case 'FALHOU':
    case 'DEVOLVIDO':
      return <span style={{ color: 'var(--recusa)' }}>Pix recusado{w.failure ? `: ${w.failure}` : ''}</span>;
    case 'CANCELADO':
      return <span style={{ color: 'var(--recusa)' }}>Saque cancelado: o tBRL não saiu da carteira{w.failure ? ` (${w.failure})` : ''}</span>;
    default:
      return (
        <span className="mudo">
          ID <span className="mono" style={{ color: 'var(--tinta)' }}>{w.e2eId}</span>
          {w.provider === 'simulator' ? ' (simulado)' : w.e2eFormat === 'sandbox' ? ' (sandbox)' : ''}, {amount}
          {key}
          <span style={{ display: 'block' }}>Antes, o tBRL foi para a tesouraria: {tx(step.tx)}</span>
        </span>
      );
  }
}
