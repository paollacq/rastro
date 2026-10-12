'use client';

import Link from 'next/link';
import { useState, type FormEvent } from 'react';
import { Comprovante } from '../../components/comprovante';
import { Erro } from '../../components/erro';
import { TxLink } from '../../components/tx-link';
import { dateTime } from '../../lib/format';

interface Done {
  id: string;
  name: string;
  wallet: string;
  cpfMasked: string;
  pixKeyMasked: string;
  pixKeyType: string;
  policyId: string;
  txHash: string | null;
  explorer: string;
  alreadyOnPolicy: boolean;
}

// Which field a refusal belongs to, so the right one gets the outline.
const FIELD: Record<string, string> = {
  invalid_name: 'name',
  invalid_cpf: 'cpf',
  invalid_pix_key: 'pixKey',
  invalid_wallet: 'wallet',
  cpf_taken: 'cpf',
  wallet_taken: 'wallet',
};

const TYPES: Record<string, string> = {
  email: 'email',
  cpf: 'CPF',
  cnpj: 'CNPJ',
  phone: 'phone',
  evp: 'random key',
};

export function CadastroForm() {
  const [state, setState] = useState<
    { kind: 'aberto' } | { kind: 'enviando' } | { kind: 'feito'; result: Done; at: string } | { kind: 'erro'; message: string; code?: string }
  >({ kind: 'aberto' });
  const [wallet, setWallet] = useState('');

  function generateWallet() {
    const bytes = new Uint8Array(20);
    crypto.getRandomValues(bytes);
    setWallet(`0x${[...bytes].map((b) => b.toString(16).padStart(2, '0')).join('')}`);
  }

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    setState({ kind: 'enviando' });
    try {
      const res = await fetch('/api/kyc', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          name: form.get('name'),
          cpf: form.get('cpf'),
          pixKey: form.get('pixKey'),
          city: form.get('city'),
          wallet: form.get('wallet'),
        }),
      });
      const body = await res.json();
      if (!res.ok) {
        setState({ kind: 'erro', message: body.error ?? 'the sign-up was not accepted', code: body.code });
        return;
      }
      setState({ kind: 'feito', result: body as Done, at: new Date().toISOString() });
    } catch (error) {
      setState({ kind: 'erro', message: `couldn't reach the server: ${String(error)}` });
    }
  }

  if (state.kind === 'feito') {
    const { result } = state;
    return (
      <Comprovante esquerda={<span className="mono">{result.id}</span>} direita={<span className="mono" suppressHydrationWarning>{dateTime(state.at, 'en')}</span>}>
        <h2>{result.name}</h2>
        <p className="selo selo--sim" style={{ marginTop: 8 }}>
          Identified wallet
        </p>
        <hr className="tracejado" />
        <dl style={{ display: 'grid', gridTemplateColumns: 'max-content 1fr', gap: '8px 20px', margin: 0 }}>
          <dt className="mudo">CPF</dt>
          <dd className="mono" style={{ margin: 0 }}>
            {result.cpfMasked}
          </dd>
          <dt className="mudo">Pix key</dt>
          <dd className="mono" style={{ margin: 0 }}>
            {result.pixKeyMasked} <span className="mudo pequeno">({TYPES[result.pixKeyType] ?? result.pixKeyType})</span>
          </dd>
          <dt className="mudo">Wallet</dt>
          <dd style={{ margin: 0, overflowWrap: 'anywhere' }}>
            <span className="mono">{result.wallet}</span>
          </dd>
          <dt className="mudo">Policy</dt>
          <dd style={{ margin: 0 }}>
            {result.policyId} · identified wallets
          </dd>
        </dl>
        <hr className="tracejado" />
        <p>
          {result.alreadyOnPolicy ? (
            'The wallet was already on the list; the sign-up was updated.'
          ) : (
            <>
              Added to the list on Tempo:{' '}
              {result.txHash && <TxLink hash={result.txHash} explorer={result.explorer} lang="en" />}
            </>
          )}
        </p>
        <p className="pequeno mudo" style={{ marginTop: 10 }}>
          From now on the protocol lets tBRL reach this wallet, and refuses the same transfer to any wallet not on the
          list. In this demo, only Ana&apos;s wallet has a server-side key to sign withdrawals.
        </p>
        <p style={{ marginTop: 20 }}>
          <Link href="/console?tab=allowlist">See it on the console list</Link>
        </p>
      </Comprovante>
    );
  }

  const invalid = state.kind === 'erro' ? FIELD[state.code ?? ''] : undefined;

  return (
    <form onSubmit={submit} style={{ display: 'grid', gap: 20, maxWidth: 480 }}>
      <div>
        <label className="rotulo" htmlFor="name">
          Full name
        </label>
        <input className="campo" id="name" name="name" autoComplete="name" required aria-invalid={invalid === 'name' || undefined} />
      </div>
      <div>
        <label className="rotulo" htmlFor="cpf">
          CPF
        </label>
        <input
          className="campo mono"
          id="cpf"
          name="cpf"
          inputMode="numeric"
          placeholder="000.000.000-00"
          required
          aria-invalid={invalid === 'cpf' || undefined}
        />
        <p className="pequeno mudo" style={{ marginTop: 6 }}>
          Use a test CPF. The screen and the report show only the middle digits.
        </p>
      </div>
      <div>
        <label className="rotulo" htmlFor="pixKey">
          Pix key
        </label>
        <input className="campo" id="pixKey" name="pixKey" required aria-invalid={invalid === 'pixKey' || undefined} />
        <p className="pequeno mudo" style={{ marginTop: 6 }}>
          Email, phone, CPF, CNPJ, or a random key.
        </p>
      </div>
      <div>
        <label className="rotulo" htmlFor="city">
          City <span className="mudo" style={{ fontWeight: 400 }}>(optional)</span>
        </label>
        <input className="campo" id="city" name="city" autoComplete="address-level2" />
      </div>
      <div>
        <label className="rotulo" htmlFor="wallet">
          Tempo wallet
        </label>
        <input
          className="campo mono"
          id="wallet"
          name="wallet"
          value={wallet}
          onChange={(e) => setWallet(e.target.value)}
          placeholder="0x…"
          required
          aria-invalid={invalid === 'wallet' || undefined}
        />
        <p className="pequeno mudo" style={{ marginTop: 6 }}>
          <button type="button" className="botao botao--secundario" onClick={generateWallet}>
            Generate a test wallet
          </button>
          <span style={{ display: 'block', marginTop: 6 }}>
            The wallet generated here is just an address, with no key: enough to show the policy, not to sign.
          </span>
        </p>
      </div>

      {state.kind === 'erro' && <Erro>{state.message}</Erro>}

      <div>
        <button type="submit" className="botao" disabled={state.kind === 'enviando'} aria-busy={state.kind === 'enviando'}>
          Sign up and join the list
        </button>
        {state.kind === 'enviando' && (
          <p className="pequeno mudo" style={{ marginTop: 8 }}>
            Sending the inclusion to the policy on Tempo…
          </p>
        )}
      </div>
    </form>
  );
}
