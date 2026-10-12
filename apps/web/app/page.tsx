import { effectivePixMode, showcaseTrace, trailOf } from '@rastro/core';
import Link from 'next/link';
import { Carimbo } from '../components/carimbo';
import { Comprovante } from '../components/comprovante';
import { Faixa } from '../components/faixa';
import { Marca } from '../components/marca';
import { Trilha, type TrilhaItem } from '../components/trilha';
import { context } from '../lib/api';
import { dateTime, money, stamp } from '../lib/format';
import { currentPixMode, load } from '../lib/load';
import { city, repository, team } from '../lib/team';
import { WaitlistForm } from './waitlist-form';

export const dynamic = 'force-dynamic';

const TITLES: Record<string, string> = {
  emitida: 'Invoice issued',
  paga: 'Paid in dollars on Tempo',
  convertida: 'Converted to reais at the PTAX rate',
  carteira: 'In the identified wallet',
  pix: 'Pix sent',
  queima: 'Burned on Tempo with the same ID',
  devolvida: 'Returned to the wallet',
};

// The landing: one sentence, a real trail instead of an illustration, a waitlist that
// writes to Postgres, and the way into the demo.
export default async function Home() {
  const mode = await load(() => effectivePixMode(context()));
  const showcase = await load(() => showcaseTrace(context()));
  const trace = showcase.ok ? showcase.data : null;
  const trail = trace ? trailOf(trace) : null;

  return (
    <>
      <Faixa lang="en" mode={mode.ok ? mode.data : currentPixMode()} />
      <main className="pagina pagina--media">
        <header className="topo">
          <Marca />
          <nav className="topo__lado" aria-label="Demo">
            <Link href="#demo">See the demo</Link>
          </nav>
        </header>

        <section>
          <h1 style={{ fontSize: 'var(--t32)', lineHeight: 1.15, maxWidth: '19em' }}>
            Dollars in, reais out by Pix, and every transfer leaves a trail.
          </h1>
          <p style={{ marginTop: 20, maxWidth: '36em' }}>
            For people in Brazil invoicing abroad: the client pays in dollars on the Tempo network, the amount is
            converted to reais at the Central Bank&apos;s PTAX rate, and leaves by Pix. The Pix ID is written on-chain
            in the burn memo, so the 32 characters can be checked on both sides.
          </p>
        </section>

        <section className="secao" aria-labelledby="exemplo">
          <h2 id="exemplo" className="sr-only">
            A real payment on the testnet
          </h2>
          {trace && trail ? (
            <>
              <Comprovante
                esquerda={<span className="mono">{trace.invoice?.id ?? trail.withdrawal?.id}</span>}
                direita={<span className="mono">{latest(trail) ? dateTime(latest(trail) as string, 'en') : 'Moderato testnet'}</span>}
              >
                <Trilha compacta items={showcaseItems(trace, trail)} lang="en" />
                {trail.comparison?.matches && (
                  <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: 8 }}>
                    <Carimbo at={trail.comparison.at} entra={false} />
                  </div>
                )}
              </Comprovante>
              <p className="pequeno mudo" style={{ marginTop: 14 }}>
                {caption(trace, trail)}{' '}
                <Link href={`/trace/${trace.invoice?.id ?? trail.withdrawal?.id}`}>Open the full trail</Link>
              </p>
            </>
          ) : showcase.ok ? (
            <p className="mudo">
              The example trail appears here as soon as demo invoice #0047 is paid on the testnet.
            </p>
          ) : (
            <p className="mudo">
              The example trail didn&apos;t load right now; reload in a few seconds.{' '}
              <span className="mono pequeno">({showcase.reason})</span>
            </p>
          )}
        </section>

        <section className="secao" aria-labelledby="lista">
          <h2 id="lista">Waitlist</h2>
          <p className="mudo" style={{ marginTop: 4, marginBottom: 16 }}>
            We&apos;ll email you when it opens to the first users. That&apos;s it.
          </p>
          <WaitlistForm />
        </section>

        <section className="secao" id="demo" aria-labelledby="demo-titulo">
          <h2 id="demo-titulo">The demo, in five screens</h2>
          <ol style={{ paddingLeft: 20, marginTop: 8, display: 'grid', gap: 8 }}>
            <li>
              <Link href="/cadastro">Sign-up</Link>{' '}
              <span className="mudo">that puts the wallet on the policy list, on Tempo</span>
            </li>
            <li>
              <Link href="/invoice/0047">The invoice the client abroad pays</Link>
            </li>
            <li>
              <Link href="/ana">Ana&apos;s screen</Link>{' '}
              <span className="mudo">with the balance, the Pix withdrawal, and the automatic option</span>
            </li>
            <li>
              <Link href="/trace/fatura-0047">The payment trail</Link>{' '}
              <span className="mudo">from the dollar to the burn, with the verified stamp</span>
            </li>
            <li>
              <Link href="/console">The exchange console</Link>{' '}
              <span className="mudo">operations, wallet list, blocks, and reserves</span>
            </li>
          </ol>
          <p className="pequeno mudo" style={{ marginTop: 12 }}>
            Fictional characters, Tempo testnet, and test Pix: no real money flows through here.
          </p>
        </section>

        <footer className="rodape">
          {team.length > 0 && (
            <p>
              {team.map((person, i) => (
                <span key={person.name}>
                  {i > 0 && ', '}
                  {person.link ? <a href={person.link}>{person.name}</a> : person.name}
                  {person.role && ` (${person.role})`}
                </span>
              ))}
              {city && `, from ${city}`}.
            </p>
          )}
          <p>
            Built at the Colosseum Crypto World&apos;s Fair hackathon, Tempo track, October 2026.
            {repository && (
              <>
                {' '}
                <a href={repository}>Code</a>.
              </>
            )}
          </p>
        </footer>
      </main>
    </>
  );
}

function showcaseItems(trace: NonNullable<Awaited<ReturnType<typeof showcaseTrace>>>, trail: ReturnType<typeof trailOf>): TrilhaItem[] {
  return trail.steps.map((step) => ({
    key: step.key,
    state: step.state,
    title:
      step.key === 'convertida' && step.state === 'feito' && trace.quote
        ? `Converted to ${money(trace.quote.brlOut, 'BRL', 'en')} at the PTAX rate`
        : step.key === 'pix' && step.state === 'feito' && trail.withdrawal?.e2eId
          ? (
              <>
                Pix sent, ID <span className="mono" style={{ fontWeight: 400 }}>{trail.withdrawal.e2eId}</span>
              </>
            )
          : TITLES[step.key],
    time: step.at ? stamp(step.at, 'en') : null,
  }));
}

const latest = (trail: ReturnType<typeof trailOf>) => [...trail.steps].reverse().find((step) => step.at)?.at ?? null;

function caption(trace: NonNullable<Awaited<ReturnType<typeof showcaseTrace>>>, trail: ReturnType<typeof trailOf>) {
  const paid = trace.invoice?.paidAt;
  if (trail.comparison?.matches) {
    return `A payment made on the testnet, from start to finish: the burn memo carries the same ${trail.comparison.length} characters as the Pix ID.`;
  }
  if (paid) return `Demo invoice #${trace.invoice?.number}, paid on the testnet at ${dateTime(new Date(paid).toISOString(), 'en')}.`;
  return `Demo invoice #${trace.invoice?.number ?? ''}, waiting for payment.`;
}
