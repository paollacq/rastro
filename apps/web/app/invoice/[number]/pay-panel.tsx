'use client';

import Link from 'next/link';
import { useCallback, useEffect, useRef, useState } from 'react';
import { Erro } from '../../../components/erro';
import { Esqueleto } from '../../../components/esqueleto';
import { Money } from '../../../components/money';
import { TxLink } from '../../../components/tx-link';
import { dateTime, money, percentFromBps, ptaxDay, rate } from '../../../lib/format';

interface Offer {
  id: string;
  quote: { brlOut: string };
  ptax: { rate: string; date: string; source: string };
  spreadBps: number;
}

interface Paid {
  brlOut: string;
  ptaxRate: string;
  ptaxDate: string;
  spreadBps: number;
  fillTx: string;
  paidAt: string;
}

type State =
  | { kind: 'cotando'; note?: string }
  | { kind: 'cotado'; offer: Offer; deadline: number; note?: string }
  | { kind: 'pagando'; offer: Offer }
  | { kind: 'pago'; brlOut: string; txHash: string; paidAt?: string }
  | { kind: 'erro'; message: string; reason?: string; offer?: Offer };

// The API answers in Portuguese; this screen is in English, so known errors come by code.
const MESSAGES: Record<string, string> = {
  invoice_paid: 'This invoice is already paid.',
  payment_in_progress: 'Another payment of this invoice is going through. Reload in a minute to see it.',
  quote_used: 'This quote was already used. Get a new rate and try again.',
  reverted: "The payment was refused on-chain, so nothing left the payer's wallet.",
  wrong_payer: "This demo only pays from the payer wallet in the server's .env.",
};

const reais = (base: string) => {
  const cents = BigInt(base) / 10_000n;
  return `${cents / 100n}.${(cents % 100n).toString().padStart(2, '0')}`;
};

export function PayPanel({
  invoiceId,
  amountUsd,
  firstName,
  payer,
  quoteSeconds,
  explorer,
  paid,
}: {
  invoiceId: string;
  amountUsd: string;
  firstName: string;
  payer: string;
  quoteSeconds: number;
  explorer: string;
  paid: Paid | null;
}) {
  const [state, setState] = useState<State>(
    paid ? { kind: 'pago', brlOut: paid.brlOut, txHash: paid.fillTx, paidAt: paid.paidAt } : { kind: 'cotando' },
  );
  const [now, setNow] = useState(() => Date.now());
  const busy = useRef(false);

  const fetchQuote = useCallback(
    async (note?: (brl: string) => string) => {
      if (busy.current) return;
      busy.current = true;
      setState({ kind: 'cotando' });
      try {
        const res = await fetch('/api/quote', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ invoiceId }),
        });
        const body = await res.json();
        if (!res.ok) {
          setState({ kind: 'erro', message: MESSAGES[body.code] ?? "We couldn't get a rate right now.", reason: body.error });
          return;
        }
        const offer = body as Offer;
        // Counted from when the quote arrived here, so a wrong clock on this computer
        // doesn't shorten or stretch it; one second is kept back for the trip.
        setState({
          kind: 'cotado',
          offer,
          deadline: Date.now() + (quoteSeconds - 1) * 1000,
          note: note?.(reais(offer.quote.brlOut)),
        });
      } catch (error) {
        setState({ kind: 'erro', message: "We couldn't reach the server.", reason: String(error) });
      } finally {
        busy.current = false;
      }
    },
    [invoiceId, quoteSeconds],
  );

  useEffect(() => {
    if (!paid) void fetchQuote();
  }, [paid, fetchQuote]);

  // The countdown, and a fresh quote when it runs out, but only while someone is looking.
  useEffect(() => {
    if (state.kind !== 'cotado') return;
    const timer = setInterval(() => setNow(Date.now()), 250);
    return () => clearInterval(timer);
  }, [state.kind]);

  const expired = state.kind === 'cotado' && now >= state.deadline;
  useEffect(() => {
    if (!expired) return;
    const renew = () => {
      if (document.visibilityState === 'visible') {
        void fetchQuote((brl) => `This quote expired, so we fetched a new one: ${money(brl, 'BRL', 'en')}.`);
      }
    };
    renew();
    document.addEventListener('visibilitychange', renew);
    return () => document.removeEventListener('visibilitychange', renew);
  }, [expired, fetchQuote]);

  async function pay(offer: Offer) {
    setState({ kind: 'pagando', offer });
    try {
      const res = await fetch('/api/pay', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ quoteId: offer.id }),
      });
      const body = await res.json();
      if (res.ok) {
        setState({ kind: 'pago', brlOut: reais(offer.quote.brlOut), txHash: body.txHash });
      } else if (body.code === 'quote_expired') {
        await fetchQuote((brl) => `This quote expired, so we fetched a new one: ${money(brl, 'BRL', 'en')}.`);
      } else {
        setState({ kind: 'erro', message: MESSAGES[body.code] ?? "The payment didn't go through.", reason: body.error, offer });
      }
    } catch (error) {
      setState({ kind: 'erro', message: "We couldn't reach the server, so we don't know yet whether it paid. Reload the page to check.", reason: String(error) });
    }
  }

  const button = `Pay ${money(amountUsd, 'USD', 'en')}`;

  if (state.kind === 'pago') {
    return (
      <div role="status">
        <p style={{ fontSize: 'var(--t18)', fontWeight: 600 }} suppressHydrationWarning>
          {state.paidAt
            ? `Paid on ${dateTime(state.paidAt, 'en')}, Brasília time.`
            : `Paid. ${firstName} usually sees it within seconds.`}
        </p>
        <p style={{ marginTop: 6 }}>
          {firstName} received <Money value={state.brlOut} currency="BRL" lang="en" /> in tBRL, ready to go out by Pix.
        </p>
        <p className="pequeno mudo" style={{ marginTop: 6 }}>
          Tempo transaction <TxLink hash={state.txHash} explorer={explorer} lang="en" />
        </p>
        <p style={{ marginTop: 20 }}>
          <Link href={`/trace/${invoiceId}`}>See the trail</Link>
        </p>
      </div>
    );
  }

  const offer = state.kind === 'cotado' || state.kind === 'pagando' ? state.offer : state.kind === 'erro' ? state.offer : undefined;
  const seconds = state.kind === 'cotado' ? Math.max(0, Math.ceil((state.deadline - now) / 1000)) : null;

  return (
    <div>
      {state.kind === 'cotado' && state.note && (
        <p className="aviso" role="status" style={{ marginBottom: 16 }}>
          {state.note}
        </p>
      )}

      {offer ? (
        <div aria-live="polite">
          <p>
            {firstName} receives <Money value={reais(offer.quote.brlOut)} currency="BRL" lang="en" /> by Pix
          </p>
          <p className="pequeno mudo" style={{ marginTop: 2 }}>
            PTAX of {ptaxDay(offer.ptax.date, 'en')} ({rate(offer.ptax.rate, 'en')}), less a {percentFromBps(offer.spreadBps, 'en')} spread
          </p>
        </div>
      ) : state.kind === 'cotando' ? (
        <div aria-busy="true">
          <span className="sr-only">Getting a rate…</span>
          <Esqueleto largura="62%" />
          <Esqueleto largura="48%" altura="0.85em" margem={8} />
        </div>
      ) : null}

      {state.kind === 'erro' && (
        <div style={{ marginTop: 16 }}>
          <Erro motivo={state.reason}>{state.message}</Erro>
        </div>
      )}

      <p className="pequeno mudo" style={{ marginTop: 14, minHeight: '1.5em' }}>
        {seconds !== null && seconds > 0 && (
          <>
            Rate locked for <span className="valor">{seconds}&nbsp;s</span>
          </>
        )}
        {state.kind === 'pagando' && 'Paying on Tempo…'}
      </p>

      {state.kind === 'erro' ? (
        <button type="button" className="botao botao--cheio" style={{ marginTop: 12 }} onClick={() => void fetchQuote()}>
          Get a new rate
        </button>
      ) : (
        <button
          type="button"
          className="botao botao--cheio"
          style={{ marginTop: 12 }}
          disabled={state.kind !== 'cotado' || expired}
          aria-busy={state.kind === 'pagando'}
          onClick={() => state.kind === 'cotado' && void pay(state.offer)}
        >
          {button}
        </button>
      )}
      <p className="pequeno mudo" style={{ marginTop: 12 }}>
        Paid in pathUSD on Tempo testnet, from {payer}&apos;s test wallet. For this demo our server holds that wallet&apos;s
        key and signs the payment.
      </p>
    </div>
  );
}
