import { Esqueleto } from '../../components/esqueleto';
import { Faixa } from '../../components/faixa';
import { currentPixMode } from '../../lib/load';

export default function Loading() {
  return (
    <>
      <Faixa lang="pt" mode={currentPixMode()} />
      <main className="pagina" aria-busy="true">
        <header className="topo">
          <Esqueleto largura="84px" altura="22px" />
        </header>
        <span className="sr-only">Carregando a carteira…</span>
        <Esqueleto largura="40%" altura="28px" />
        <Esqueleto largura="65%" margem={10} />
        <div className="secao">
          <Esqueleto largura="25%" />
          <Esqueleto largura="50%" altura="38px" margem={8} />
        </div>
        <div className="secao">
          <Esqueleto largura="30%" altura="22px" />
          <Esqueleto largura="100%" altura="96px" margem={16} />
        </div>
      </main>
    </>
  );
}
