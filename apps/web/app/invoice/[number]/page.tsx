import { explorer, invoiceView } from '@rastro/core';
import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { Comprovante } from '../../../components/comprovante';
import { Erro } from '../../../components/erro';
import { Faixa } from '../../../components/faixa';
import { Marca } from '../../../components/marca';
import { Money } from '../../../components/money';
import { context } from '../../../lib/api';
import { date, money } from '../../../lib/format';
import { currentPixMode, load } from '../../../lib/load';
import { PayPanel } from './pay-panel';

export const dynamic = 'force-dynamic';

export async function generateMetadata({ params }: { params: Promise<{ number: string }> }): Promise<Metadata> {
  const { number } = await params;
  return { title: `Invoice #${number}` };
}

// The payer's screen, in English: pay in dollars without having to think about crypto.
export default async function InvoicePage({ params }: { params: Promise<{ number: string }> }) {
  const { number } = await params;
  const loaded = await load(() => invoiceView(context(), number));
  if (loaded.ok && !loaded.data) notFound();

  return (
    <div lang="en">
      <Faixa lang="en" mode={loaded.ok && loaded.data ? loaded.data.pixMode : currentPixMode()} />
      <main className="pagina">
        <header className="topo">
          <Marca rotulo="rastro, home" />
        </header>

        {!loaded.ok || !loaded.data ? (
          <Erro motivo={loaded.ok ? null : loaded.reason}>
            We couldn&apos;t load this invoice. Reload the page in a few seconds; if it keeps failing, the database or the
            Tempo node is down.
          </Erro>
        ) : (
          <Invoice view={loaded.data} />
        )}
      </main>
    </div>
  );
}

function Invoice({ view }: { view: NonNullable<Awaited<ReturnType<typeof invoiceView>>> }) {
  const { invoice, recipient, payment } = view;
  const firstName = recipient.name.split(' ')[0] || recipient.name;
  return (
    <Comprovante esquerda={<span className="mono">{invoice.id}</span>} direita={`Issued ${date(invoice.issuedAt, 'en')}`}>
      <h1>
        Invoice #{invoice.number} from {recipient.name}
      </h1>
      <p className="mudo" style={{ marginTop: 6 }}>
        {recipient.city ? `${recipient.city}, Brazil. ` : ''}Billed to {invoice.payerName}
      </p>

      <hr className="tracejado" />
      {invoice.items.length > 0 ? (
        invoice.items.map((item) => (
          <div key={item.description} style={{ marginBottom: 10 }}>
            <p>{item.description}</p>
            <p className="linha-valor mudo">
              <span className="valor valor--mono">
                {item.hours} h × {money(item.rateUsd, 'USD', 'en')}
              </span>
              <Money value={(item.hours * Number(item.rateUsd)).toFixed(2)} currency="USD" lang="en" mono />
            </p>
          </div>
        ))
      ) : (
        <p>{invoice.description}</p>
      )}
      <hr className="tracejado" />
      <p className="linha-valor linha-valor--total">
        <span>Total</span>
        <Money value={invoice.amountUsd} currency="USD" lang="en" mono />
      </p>

      <div style={{ marginTop: 28 }}>
        <PayPanel
          invoiceId={invoice.id}
          amountUsd={invoice.amountUsd}
          firstName={firstName}
          payer={invoice.payerName.replace(/,? Inc\.?$/, '')}
          quoteSeconds={view.quoteSeconds}
          explorer={explorer}
          paid={payment}
        />
      </div>
    </Comprovante>
  );
}
