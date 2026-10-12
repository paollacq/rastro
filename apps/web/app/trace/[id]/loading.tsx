import { Esqueleto } from '../../../components/esqueleto';
import { Faixa } from '../../../components/faixa';
import { currentPixMode } from '../../../lib/load';

// The trail's shape: six steps on a line, before the data arrives.
export default function Loading() {
  return (
    <>
      <Faixa lang="en" mode={currentPixMode()} />
      <main className="pagina pagina--media" aria-busy="true">
        <header className="topo">
          <Esqueleto largura="84px" altura="22px" />
        </header>
        <span className="sr-only">Loading the trail…</span>
        <Esqueleto largura="35%" altura="28px" />
        <Esqueleto largura="55%" margem={10} />
        <section className="comprovante" style={{ marginTop: 40 }}>
          <ol className="trilha">
            {[0, 1, 2, 3, 4, 5].map((i) => (
              <li key={i} className="passo passo--esperando">
                <span className="passo__ponto" aria-hidden="true" />
                <div>
                  <Esqueleto largura={`${60 - i * 4}%`} />
                  <Esqueleto largura="35%" altura="0.8em" margem={6} />
                </div>
              </li>
            ))}
          </ol>
        </section>
      </main>
    </>
  );
}
