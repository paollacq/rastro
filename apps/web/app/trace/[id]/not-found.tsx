import Link from 'next/link';
import { Faixa } from '../../../components/faixa';
import { Marca } from '../../../components/marca';
import { currentPixMode } from '../../../lib/load';

export default function TraceNotFound() {
  return (
    <>
      <Faixa lang="en" mode={currentPixMode()} />
      <main className="pagina pagina--media">
        <header className="topo">
          <Marca />
        </header>
        <h1>We couldn&apos;t find that trail</h1>
        <p style={{ marginTop: 8 }}>
          Check the link: trails have addresses like <span className="mono">/trace/fatura-0047</span> or{' '}
          <span className="mono">/trace/saque-k3j9x2m1</span>.
        </p>
        <p style={{ marginTop: 24 }}>
          <Link href="/trace/fatura-0047">See the trail of invoice #0047</Link>
        </p>
      </main>
    </>
  );
}
