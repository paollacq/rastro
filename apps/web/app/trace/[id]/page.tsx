import { effectivePixMode, trace } from '@rastro/core';
import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { Erro } from '../../../components/erro';
import { Faixa } from '../../../components/faixa';
import { Marca } from '../../../components/marca';
import { context } from '../../../lib/api';
import { currentPixMode, load } from '../../../lib/load';
import { TraceView } from './trace-view';

export const dynamic = 'force-dynamic';

export async function generateMetadata({ params }: { params: Promise<{ id: string }> }): Promise<Metadata> {
  const { id } = await params;
  const invoice = /^fatura-(\d+)$/.exec(id);
  return { title: invoice ? `Trail of invoice #${invoice[1]}` : `Trail of ${id}` };
}

// Public, by link: proof, step by step, that the money arrived and left a trail.
export default async function TracePage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const mode = await load(() => effectivePixMode(context()));
  const loaded = await load(() => trace(context(), id));
  if (loaded.ok && !loaded.data) notFound();

  return (
    <>
      <Faixa lang="en" mode={mode.ok ? mode.data : currentPixMode()} />
      <main className="pagina pagina--media">
        <header className="topo">
          <Marca />
          <p className="topo__lado">Trail</p>
        </header>
        {!loaded.ok || !loaded.data ? (
          <Erro motivo={loaded.ok ? null : loaded.reason}>
            Couldn&apos;t load this trail. Reload in a few seconds; if it keeps failing, the database is down.
          </Erro>
        ) : (
          // Through JSON on purpose: the page and the polling hand the view the same shape.
          <TraceView id={id} initial={JSON.parse(JSON.stringify(loaded.data))} />
        )}
      </main>
    </>
  );
}
