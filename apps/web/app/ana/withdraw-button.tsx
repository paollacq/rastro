'use client';

import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { Erro } from '../../components/erro';
import { money, type Lang } from '../../lib/format';

const MESSAGES: Record<Lang, Record<string, string>> = {
  pt: {
    insufficient_balance: 'O saldo em tBRL é menor que este saque. Recarregue a página para ver o valor de agora.',
    already_withdrawn: 'Esta fatura já tem um saque em andamento ou concluído. Recarregue a página para ver.',
    no_pix_key: 'Falta uma chave Pix no cadastro.',
    transfer_failed: 'O tBRL não saiu da carteira, então nada mudou. Tente de novo em alguns segundos.',
  },
  en: {
    insufficient_balance: 'Your tBRL balance is smaller than this withdrawal. Reload to see the current amount.',
    already_withdrawn: 'This invoice already has a withdrawal going or done. Reload to see it.',
    no_pix_key: 'There is no Pix key on file.',
    transfer_failed: "The tBRL didn't leave the wallet, so nothing changed. Try again in a few seconds.",
  },
};

// "Sacar R$ 8.293,26 por Pix": Ana's tBRL goes to the treasury with the withdrawal id as
// memo, and the screen moves to the trail to watch the rest happen.
export function WithdrawButton({ amountBrl, invoiceId, pixKey, lang }: { amountBrl: string; invoiceId: string; pixKey: string | null; lang: Lang }) {
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
        const fallback = lang === 'pt' ? 'O saque não foi pedido.' : "The withdrawal wasn't requested.";
        setState({ kind: 'erro', message: MESSAGES[lang][body.code] ?? fallback, reason: body.error });
        return;
      }
      router.push(`/trace/${body.id}`);
    } catch (error) {
      setState({
        kind: 'erro',
        message: lang === 'pt' ? 'Não deu para falar com o servidor. Recarregue a página para ver se o saque saiu.' : "Couldn't reach the server. Reload to see whether the withdrawal went out.",
        reason: String(error),
      });
    }
  }

  const label = lang === 'pt' ? `Sacar ${money(amountBrl, 'BRL', lang)} por Pix` : `Withdraw ${money(amountBrl, 'BRL', lang)} by Pix`;
  return (
    <div>
      <button type="button" className="botao" onClick={withdraw} disabled={state.kind === 'enviando'} aria-busy={state.kind === 'enviando'}>
        {label}
      </button>
      {pixKey && (
        <p className="pequeno mudo" style={{ marginTop: 6 }}>
          {lang === 'pt' ? `Para a chave ${pixKey}` : `To the key ${pixKey}`}
          {state.kind === 'enviando' && (lang === 'pt' ? ' · enviando o tBRL para a tesouraria…' : ' · sending the tBRL to the treasury…')}
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
