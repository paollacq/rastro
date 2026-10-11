import Link from 'next/link';
import { Faixa } from '../components/faixa';
import { Marca } from '../components/marca';
import { currentPixMode } from '../lib/load';

export default function NotFound() {
  return (
    <>
      <Faixa lang="pt" mode={currentPixMode()} />
      <main className="pagina">
        <header className="topo">
          <Marca />
        </header>
        <h1>Esta página não existe</h1>
        <p style={{ marginTop: 8 }}>
          Talvez o endereço tenha mudado. A demonstração começa pela <Link href="/invoice/0047">fatura #0047</Link>.
        </p>
        <p className="mudo" lang="en" style={{ marginTop: 4 }}>
          This page doesn&apos;t exist. The demo starts at invoice #0047.
        </p>
      </main>
    </>
  );
}
