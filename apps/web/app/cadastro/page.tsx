import type { Metadata } from 'next';
import Link from 'next/link';
import { Faixa } from '../../components/faixa';
import { Marca } from '../../components/marca';
import { context } from '../../lib/api';
import { load } from '../../lib/load';
import { effectivePixMode } from '@rastro/core';
import { CadastroForm } from './form';

export const dynamic = 'force-dynamic';
export const metadata: Metadata = { title: 'Sign-up' };

// The sign-up: it is what puts a wallet on the TIP-403 whitelist, which is what lets tBRL
// reach it at all. Simulated as far as the documents go, real on-chain.
export default async function CadastroPage() {
  const mode = await load(() => effectivePixMode(context()));

  return (
    <>
      <Faixa lang="en" mode={mode.ok ? mode.data : 'simulator'} />
      <main className="pagina">
        <header className="topo">
          <Marca />
          <nav className="topo__lado">
            <Link href="/">Home</Link>
          </nav>
        </header>

        <h1>Sign-up</h1>
        <p className="mudo" style={{ marginTop: 6, maxWidth: '38em' }}>
          To receive tBRL, a wallet has to be on the TIP-403 policy list. The sign-up puts it there, and the protocol
          refuses any transfer to a wallet that isn&apos;t on the list.
        </p>

        <div style={{ marginTop: 32 }}>
          <CadastroForm />
        </div>

        <p className="rodape">
          Demo: the document check is simulated, only the CPF check digit is verified. The CPF isn&apos;t stored: the
          database keeps a hash, and the screen shows at most the middle digits. The inclusion on the policy is real,
          on the Tempo testnet.
        </p>
      </main>
    </>
  );
}
