'use client';

import { useCallback, useEffect, useState } from 'react';
import { Erro } from '../../components/erro';
import { Money } from '../../components/money';
import { ReserveGauge } from '../../components/reserve-gauge';
import { TxLink } from '../../components/tx-link';
import { dateTime, money } from '../../lib/format';

interface Reserves {
  supply: { ok: true; value: string } | { ok: false; error: string };
  balance: { ok: true; value: string } | { ok: false; error: string };
  provider: string;
  shortfall: string | null;
  paused: { ok: true; value: boolean } | { ok: false; error: string };
  pausedAt: string | null;
}

const TOKEN_KEY = 'rastro.admin';
const EXPLORER = 'https://explore.testnet.tempo.xyz';

export function AdminPanels() {
  const [token, setToken] = useState('');
  const [reserves, setReserves] = useState<Reserves | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [note, setNote] = useState<{ kind: 'ok' | 'erro'; text: string; tx?: string | null } | null>(null);
  const [wallet, setWallet] = useState('');

  useEffect(() => {
    try {
      setToken(sessionStorage.getItem(TOKEN_KEY) ?? '');
    } catch {
      // a private window with storage blocked: the field just starts empty
    }
  }, []);

  const refresh = useCallback(async () => {
    try {
      const res = await fetch('/api/reserves', { cache: 'no-store' });
      if (res.ok) setReserves((await res.json()) as Reserves);
    } catch {
      // the panel keeps whatever it had
    }
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  function remember(value: string) {
    setToken(value);
    try {
      sessionStorage.setItem(TOKEN_KEY, value);
    } catch {
      // nothing to do: the token stays in memory for this page
    }
  }

  async function call(what: string, path: string, body: Record<string, unknown>) {
    setBusy(what);
    setNote(null);
    try {
      const res = await fetch(path, {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'x-admin-token': token },
        body: JSON.stringify(body),
      });
      const answer = await res.json();
      if (!res.ok) {
        setNote({ kind: 'erro', text: answer.error ?? `o servidor respondeu ${res.status}` });
        return null;
      }
      return answer as Record<string, string | null>;
    } catch (error) {
      setNote({ kind: 'erro', text: `não deu para falar com o servidor: ${String(error)}` });
      return null;
    } finally {
      setBusy(null);
      void refresh();
    }
  }

  const paused = reserves?.paused.ok ? reserves.paused.value : false;
  const short = reserves?.shortfall && reserves.shortfall !== '0.00';

  return (
    <>
      <section className="secao">
        <label className="rotulo" htmlFor="token">
          ADMIN_TOKEN
        </label>
        <input
          className="campo mono"
          id="token"
          type="password"
          autoComplete="off"
          value={token}
          onChange={(e) => remember(e.target.value)}
          placeholder="o mesmo do .env do servidor"
          style={{ maxWidth: 420 }}
        />
      </section>

      {note && (
        <div className="secao">
          {note.kind === 'erro' ? (
            <Erro>{note.text}</Erro>
          ) : (
            <p className="aviso" role="status">
              {note.text}{' '}
              {note.tx && <TxLink hash={note.tx} explorer={EXPLORER} lang="pt" />}
            </p>
          )}
        </div>
      )}

      <section className="secao" aria-labelledby="lastro">
        <h2 id="lastro">Lastro</h2>
        {reserves?.supply.ok && reserves.balance.ok ? (
          <>
            <div style={{ margin: '14px 0' }}>
              <ReserveGauge supply={reserves.supply.value} balance={reserves.balance.value} lang="pt" />
            </div>
            <p style={{ fontWeight: 600, color: short ? 'var(--recusa)' : 'var(--conferido)' }}>
              {short ? (
                <>
                  Faltam <Money value={reserves.shortfall ?? '0'} currency="BRL" lang="pt" /> de lastro.
                </>
              ) : (
                'Bate: todo tBRL em circulação tem um real atrás.'
              )}
            </p>
          </>
        ) : (
          <p className="mudo">Lendo o supply e o saldo…</p>
        )}
        <p className="mudo pequeno" style={{ marginTop: 6 }}>
          Pix por {reserves?.provider ?? '…'}.{' '}
          {paused ? (
            <strong style={{ color: 'var(--recusa)' }}>
              tBRL pausado{reserves?.pausedAt ? ` às ${dateTime(reserves.pausedAt, 'pt')}` : ''}: nada se move até restaurar.
            </strong>
          ) : (
            'tBRL funcionando.'
          )}
        </p>

        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 10, marginTop: 16 }}>
          <button
            type="button"
            className="botao botao--secundario"
            disabled={!token || busy !== null}
            onClick={async () => {
              const answer = await call('check', '/api/admin/reserves', { action: 'check' });
              if (answer) setNote({ kind: 'ok', text: 'Conferido agora.' });
            }}
          >
            Conferir agora
          </button>
          <button
            type="button"
            className="botao"
            disabled={!token || busy !== null || paused}
            onClick={async () => {
              const answer = await call('break', '/api/admin/reserves', { action: 'break', amountBrl: '1000.00' });
              if (answer) {
                setNote({
                  kind: 'ok',
                  text: `Emitidos ${money(String(answer.mintedBrl), 'BRL', 'pt')} sem lastro. O monitor pausa o tBRL em até 15 s.`,
                  tx: answer.txHash,
                });
              }
            }}
          >
            Quebrar o lastro: emitir R$ 1.000,00
          </button>
          <button
            type="button"
            className="botao botao--secundario"
            disabled={!token || busy !== null}
            onClick={async () => {
              const answer = await call('restore', '/api/admin/reserves', { action: 'restore' });
              if (answer) {
                setNote({
                  kind: 'ok',
                  text: `Restaurado: ${money(String(answer.burnedBrl), 'BRL', 'pt')} queimados e o tBRL despausado.`,
                  tx: answer.burnTx ?? answer.unpauseTx,
                });
              }
            }}
          >
            Restaurar
          </button>
        </div>
        <p className="pequeno mudo" style={{ marginTop: 10 }}>
          Quebrar emite tBRL para a tesouraria sem real nenhum atrás. Restaurar despausa e queima o excesso.
        </p>
      </section>

      <section className="secao" aria-labelledby="politica">
        <h2 id="politica">Política</h2>
        <p className="mudo" style={{ marginTop: 4 }}>
          Tenta mandar R$ 1,00 do tBRL da Ana para outra carteira. Fora da lista da política, o protocolo recusa antes
          de entrar em bloco, e a tentativa aparece na aba Blocked do console.
        </p>
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 10, marginTop: 14, alignItems: 'flex-end' }}>
          <div style={{ flex: '1 1 320px' }}>
            <label className="rotulo" htmlFor="wallet">
              Carteira
            </label>
            <input
              className="campo mono"
              id="wallet"
              value={wallet}
              onChange={(e) => setWallet(e.target.value)}
              placeholder="0x…"
            />
          </div>
          <button
            type="button"
            className="botao"
            disabled={!token || busy !== null || !wallet}
            onClick={async () => {
              const answer = await call('policy', '/api/admin/policy-test', { wallet, amountBrl: '1.00' });
              if (answer) {
                setNote(
                  answer.allowed
                    ? { kind: 'ok', text: 'A política deixou passar: R$ 1,00 em tBRL enviados.', tx: answer.txHash }
                    : { kind: 'erro', text: `Barrado pelo protocolo: ${answer.reason}` },
                );
              }
            }}
          >
            Tentar enviar R$ 1,00
          </button>
        </div>
      </section>

      <section className="secao" aria-labelledby="pix">
        <h2 id="pix">Pix</h2>
        <p className="mudo" style={{ marginTop: 4 }}>
          A credencial do sandbox dura 24 h. Quando ela para de responder, o worker troca sozinho para o simulador; aqui
          dá para trocar na mão.
        </p>
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 10, marginTop: 14 }}>
          {(['sandbox', 'simulator'] as const).map((mode) => (
            <button
              key={mode}
              type="button"
              className="botao botao--secundario"
              disabled={!token || busy !== null || reserves?.provider === (mode === 'sandbox' ? 'payzu-sandbox' : 'simulator')}
              onClick={async () => {
                const answer = await call(mode, '/api/admin/pix-mode', { mode });
                if (answer) setNote({ kind: 'ok', text: `Novos saques vão pelo ${answer.mode}.` });
              }}
            >
              {mode === 'sandbox' ? 'Usar o sandbox da PayZu' : 'Usar o simulador'}
            </button>
          ))}
        </div>
      </section>
    </>
  );
}
