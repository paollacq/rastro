'use client';

import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { Erro } from '../../components/erro';
import { money } from '../../lib/format';

const MESSAGES: Record<string, string> = {
  insufficient_balance: 'Your tBRL balance is smaller than this withdrawal. Reload to see the current amount.',
  already_withdrawn: 'This invoice already has a withdrawal going or done. Reload to see it.',
  no_pix_key: 'There is no Pix key on file.',
  transfer_failed: "The tBRL didn't leave the wallet, so nothing changed. Try again in a few seconds.",
};

// "Withdraw R$ 8,293.26 by Pix": Ana's tBRL goes to the treasury with the withdrawal id as
// memo, and the screen moves to the trail to watch the rest happen.
export function WithdrawButton({ amountBrl, invoiceId, pixKey }: { amountBrl: string; invoiceId: string; pixKey: string | null }) {
  const router = useRouter();
  const [state, setState] = useState<{ kind: 'pronto' } | { kind: 'enviando' } | { kind: 'erro'; message: string; reason?: string }>({
    kind: 'pronto',
  });

  async function withdraw() {
    setState({ kind: 'enviando' });
    try {
      const res = await fetch('/api/withdraw', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ amountBrl, invoiceId }),
      });
      const body = await res.json();
      if (!res.ok) {
        setState({ kind: 'erro', message: MESSAGES[body.code] ?? "The withdrawal wasn't requested.", reason: body.error });
        return;
      }
      router.push(`/trace/${body.id}`);
    } catch (error) {
      setState({
        kind: 'erro',
        message: "Couldn't reach the server. Reload to see whether the withdrawal went out.",
        reason: String(error),
      });
    }
  }

  const label = `Withdraw ${money(amountBrl, 'BRL', 'en')} by Pix`;
  return (
    <div>
      <button type="button" className="botao" onClick={withdraw} disabled={state.kind === 'enviando'} aria-busy={state.kind === 'enviando'}>
        {label}
      </button>
      {pixKey && (
        <p className="pequeno mudo" style={{ marginTop: 6 }}>
          To the key {pixKey}
          {state.kind === 'enviando' && ' · sending the tBRL to the treasury…'}
        </p>
      )}
      {state.kind === 'erro' && (
        <div style={{ marginTop: 12 }}>
          <Erro motivo={state.reason}>{state.message}</Erro>
        </div>
      )}
    </div>
  );
}
