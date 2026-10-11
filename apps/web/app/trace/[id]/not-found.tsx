import Link from 'next/link';
import { Faixa } from '../../../components/faixa';
import { Marca } from '../../../components/marca';
import { currentPixMode } from '../../../lib/load';

export default function TraceNotFound() {
  return (
    <>
      <Faixa lang="pt" mode={currentPixMode()} />
      <main className="pagina pagina--media">
        <header className="topo">
          <Marca />
        </header>
        <h1>Não achamos esse rastro</h1>
        <p style={{ marginTop: 8 }}>
          Confira o link: os rastros têm endereços como <span className="mono">/trace/fatura-0047</span> ou{' '}
          <span className="mono">/trace/saque-k3j9x2m1</span>.
        </p>
        <p className="mudo" lang="en" style={{ marginTop: 4 }}>
          We couldn&apos;t find that trail. Check the link.
        </p>
        <p style={{ marginTop: 24 }}>
          <Link href="/trace/fatura-0047">Ver o rastro da fatura #0047</Link>
        </p>
      </main>
    </>
  );
}
