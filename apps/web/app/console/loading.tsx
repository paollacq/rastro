import { Esqueleto } from '../../components/esqueleto';
import { Faixa } from '../../components/faixa';
import { currentPixMode } from '../../lib/load';

export default function Loading() {
  return (
    <div lang="en">
      <Faixa lang="en" mode={currentPixMode()} />
      <main className="pagina pagina--larga" aria-busy="true">
        <header className="topo">
          <Esqueleto largura="84px" altura="22px" />
        </header>
        <span className="sr-only">Loading the console…</span>
        <Esqueleto largura="360px" altura="28px" />
        <div style={{ marginTop: 28, borderTop: '1px solid var(--tinta)' }}>
          {[0, 1, 2, 3].map((i) => (
            <div key={i} style={{ padding: '14px 0', borderBottom: '1px solid var(--linha)' }}>
              <Esqueleto largura="100%" />
            </div>
          ))}
        </div>
      </main>
    </div>
  );
}
