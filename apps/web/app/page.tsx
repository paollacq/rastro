import { showcaseTrace, trailOf } from '@rastro/core';
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
  emitida: 'Fatura emitida',
  paga: 'Pago em dólar no Tempo',
  convertida: 'Convertido em reais pela PTAX',
  carteira: 'Na carteira identificada',
  pix: 'Pix enviado',
  queima: 'Queimado no Tempo com o mesmo ID',
  devolvida: 'Devolvido à carteira',
};

// The landing: one sentence, a real trail instead of an illustration, a waitlist that
// writes to Postgres, and the way into the demo.
export default async function Home() {
  const showcase = await load(() => showcaseTrace(context()));
  const trace = showcase.ok ? showcase.data : null;
  const trail = trace ? trailOf(trace) : null;

  return (
    <>
      <Faixa lang="pt" mode={currentPixMode()} />
      <main className="pagina pagina--media">
        <header className="topo">
          <Marca />
          <nav className="topo__lado" aria-label="Demonstração">
            <Link href="#demo">Ver a demo</Link>
          </nav>
        </header>

        <section>
          <h1 style={{ fontSize: 'var(--t32)', lineHeight: 1.15, maxWidth: '19em' }}>
            Dólar entra, real sai por Pix, e cada transferência deixa rastro.
          </h1>
          <p lang="en" className="mudo" style={{ marginTop: 10, fontSize: 'var(--t18)' }}>
            Dollars in on Tempo. Reais out by Pix. Every transfer leaves a trail.
          </p>
          <p style={{ marginTop: 20, maxWidth: '36em' }}>
            Para quem mora no Brasil e fatura para fora: o cliente paga em dólar na rede Tempo, o valor vira real pela PTAX
            do Banco Central e sai por Pix. O ID do Pix fica gravado on-chain no memo da queima, então dá para conferir os 32
            caracteres de um lado e do outro.
          </p>
        </section>

        <section className="secao" aria-labelledby="exemplo">
          <h2 id="exemplo" className="sr-only">
            Um pagamento de verdade, na testnet
          </h2>
          {trace && trail ? (
            <>
              <Comprovante
                esquerda={<span className="mono">{trace.invoice?.id ?? trail.withdrawal?.id}</span>}
                direita={<span className="mono">{latest(trail) ? dateTime(latest(trail) as string, 'pt') : 'testnet Moderato'}</span>}
              >
                <Trilha compacta items={showcaseItems(trace, trail)} />
                {trail.comparison?.matches && (
                  <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: 8 }}>
                    <Carimbo at={trail.comparison.at} entra={false} />
                  </div>
                )}
              </Comprovante>
              <p className="pequeno mudo" style={{ marginTop: 14 }}>
                {caption(trace, trail)}{' '}
                <Link href={`/trace/${trace.invoice?.id ?? trail.withdrawal?.id}`}>Abrir o rastro completo</Link>
              </p>
            </>
          ) : showcase.ok ? (
            <p className="mudo">
              O rastro de exemplo aparece aqui assim que a fatura #0047 da demonstração for paga na testnet.
            </p>
          ) : (
            <p className="mudo">
              O rastro de exemplo não carregou agora; recarregue em alguns segundos.{' '}
              <span className="mono pequeno">({showcase.reason})</span>
            </p>
          )}
        </section>

        <section className="secao" aria-labelledby="lista">
          <h2 id="lista">Lista de espera</h2>
          <p className="mudo" style={{ marginTop: 4, marginBottom: 16 }}>
            Avisamos por e-mail quando abrir para os primeiros usuários. Só para isso.
          </p>
          <WaitlistForm />
        </section>

        <section className="secao" id="demo" aria-labelledby="demo-titulo">
          <h2 id="demo-titulo">A demonstração, em quatro telas</h2>
          <ol style={{ paddingLeft: 20, marginTop: 8, display: 'grid', gap: 8 }}>
            <li>
              <Link href="/invoice/0047">A fatura que o cliente de fora paga</Link>{' '}
              <span className="mudo">(em inglês, como ele veria)</span>
            </li>
            <li>
              <Link href="/ana">A tela da Ana</Link> <span className="mudo">com o saldo, o saque por Pix e a opção automática</span>
            </li>
            <li>
              <Link href="/trace/fatura-0047">O rastro do pagamento</Link>{' '}
              <span className="mudo">do dólar à queima, com o carimbo de conferido</span>
            </li>
            <li>
              <Link href="/console">O console da corretora</Link>{' '}
              <span className="mudo">(em inglês): operações, lista de carteiras, bloqueios e lastro</span>
            </li>
          </ol>
          <p className="pequeno mudo" style={{ marginTop: 12 }}>
            Personagens fictícios, testnet do Tempo e Pix de teste: nenhum dinheiro de verdade passa por aqui.
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
              {city && `, de ${city}`}.
            </p>
          )}
          <p>
            Feito no hackathon Crypto World&apos;s Fair da Colosseum, trilha Tempo, em outubro de 2026.
            {repository && (
              <>
                {' '}
                <a href={repository}>Código</a>.
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
        ? `Convertido em ${money(trace.quote.brlOut, 'BRL', 'pt')} pela PTAX`
        : step.key === 'pix' && step.state === 'feito' && trail.withdrawal?.e2eId
          ? (
              <>
                Pix enviado, ID <span className="mono" style={{ fontWeight: 400 }}>{trail.withdrawal.e2eId}</span>
              </>
            )
          : TITLES[step.key],
    time: step.at ? stamp(step.at, 'pt') : null,
  }));
}

const latest = (trail: ReturnType<typeof trailOf>) => [...trail.steps].reverse().find((step) => step.at)?.at ?? null;

function caption(trace: NonNullable<Awaited<ReturnType<typeof showcaseTrace>>>, trail: ReturnType<typeof trailOf>) {
  const paid = trace.invoice?.paidAt;
  if (trail.comparison?.matches) {
    return `Um pagamento feito na testnet, do começo ao fim: o memo da queima tem os mesmos ${trail.comparison.length} caracteres do ID do Pix.`;
  }
  if (paid) return `Fatura #${trace.invoice?.number} da demonstração, paga na testnet em ${dateTime(new Date(paid).toISOString(), 'pt')}.`;
  return `Fatura #${trace.invoice?.number ?? ''} da demonstração, esperando pagamento.`;
}
