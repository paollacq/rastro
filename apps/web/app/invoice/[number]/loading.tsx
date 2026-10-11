import { Esqueleto } from '../../../components/esqueleto';
import { Faixa } from '../../../components/faixa';
import { currentPixMode } from '../../../lib/load';

export default function Loading() {
  return (
    <div lang="en">
      <Faixa lang="en" mode={currentPixMode()} />
      <main className="pagina" aria-busy="true">
        <header className="topo">
          <Esqueleto largura="84px" altura="22px" />
        </header>
        <section className="comprovante">
          <span className="sr-only">Loading the invoice…</span>
          <Esqueleto largura="70%" altura="28px" />
          <Esqueleto largura="55%" margem={12} />
          <hr className="tracejado" />
          <Esqueleto largura="45%" />
          <Esqueleto largura="100%" margem={10} />
          <hr className="tracejado" />
          <Esqueleto largura="100%" altura="22px" />
          <Esqueleto largura="100%" altura="48px" margem={40} />
        </section>
      </main>
    </div>
  );
}
