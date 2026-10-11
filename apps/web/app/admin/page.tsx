import type { Metadata } from 'next';
import Link from 'next/link';
import { Faixa } from '../../components/faixa';
import { Marca } from '../../components/marca';
import { context } from '../../lib/api';
import { load } from '../../lib/load';
import { effectivePixMode } from '@rastro/core';
import { AdminPanels } from './panels';

export const dynamic = 'force-dynamic';
export const metadata: Metadata = { title: 'Admin', robots: { index: false, follow: false } };

// The team's own screen: break the backing on purpose for the technical demo, put it back,
// try a transfer against the policy, and switch which Pix is behind the app. Every action
// goes through /api/admin/*, which only answers with the ADMIN_TOKEN from the server's .env.
export default async function AdminPage() {
  const mode = await load(() => effectivePixMode(context()));

  return (
    <>
      <Faixa lang="pt" mode={mode.ok ? mode.data : 'simulator'} />
      <main className="pagina pagina--media">
        <header className="topo">
          <Marca />
          <nav className="topo__lado">
            <Link href="/console">Console</Link>
          </nav>
        </header>

        <h1>Admin</h1>
        <p className="mudo" style={{ marginTop: 6, maxWidth: '38em' }}>
          Interno, para a gravação da demo técnica. O token fica só nesta aba, enquanto ela estiver aberta.
        </p>

        <AdminPanels />
      </main>
    </>
  );
}
