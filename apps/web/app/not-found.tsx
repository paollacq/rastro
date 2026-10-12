import Link from 'next/link';
import { Faixa } from '../components/faixa';
import { Marca } from '../components/marca';
import { currentPixMode } from '../lib/load';

export default function NotFound() {
  return (
    <>
      <Faixa lang="en" mode={currentPixMode()} />
      <main className="pagina">
        <header className="topo">
          <Marca />
        </header>
        <h1>This page doesn&apos;t exist</h1>
        <p style={{ marginTop: 8 }}>
          Maybe the address changed. The demo starts at <Link href="/invoice/0047">invoice #0047</Link>.
        </p>
      </main>
    </>
  );
}
