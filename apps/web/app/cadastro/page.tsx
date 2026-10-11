import type { Metadata } from 'next';
import Link from 'next/link';
import { Faixa } from '../../components/faixa';
import { Marca } from '../../components/marca';
import { context } from '../../lib/api';
import { load } from '../../lib/load';
import { effectivePixMode } from '@rastro/core';
import { CadastroForm } from './form';

export const dynamic = 'force-dynamic';
export const metadata: Metadata = { title: 'Cadastro' };

// The cadastro, in Portuguese: it is what puts a wallet on the TIP-403 whitelist, which is
// what lets tBRL reach it at all. Simulated as far as the documents go, real on-chain.
export default async function CadastroPage() {
  const mode = await load(() => effectivePixMode(context()));

  return (
    <>
      <Faixa lang="pt" mode={mode.ok ? mode.data : 'simulator'} />
      <main className="pagina">
        <header className="topo">
          <Marca />
          <nav className="topo__lado">
            <Link href="/">Início</Link>
          </nav>
        </header>

        <h1>Cadastro</h1>
        <p className="mudo" style={{ marginTop: 6, maxWidth: '38em' }}>
          Para receber em tBRL, a carteira precisa estar na lista da política TIP-403. O cadastro é o que põe ela lá, e
          é o protocolo que recusa qualquer transferência para quem não está.
        </p>

        <div style={{ marginTop: 32 }}>
          <CadastroForm />
        </div>

        <p className="rodape">
          Demonstração: a conferência de documento é simulada, só o dígito verificador do CPF é checado. O CPF não fica
          guardado: o banco grava um hash, e a tela mostra no máximo os dígitos do meio. A inclusão na política é real,
          na testnet do Tempo.
        </p>
      </main>
    </>
  );
}
