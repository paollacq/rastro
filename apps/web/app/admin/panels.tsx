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
        setNote({ kind: 'erro', text: answer.error ?? `the server answered ${res.status}` });
        return null;
      }
      return answer as Record<string, string | null>;
    } catch (error) {
      setNote({ kind: 'erro', text: `couldn't reach the server: ${String(error)}` });
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
          placeholder="the same one in the server .env"
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
              {note.tx && <TxLink hash={note.tx} explorer={EXPLORER} lang="en" />}
            </p>
          )}
        </div>
      )}

      <section className="secao" aria-labelledby="lastro">
        <h2 id="lastro">Backing</h2>
        {reserves?.supply.ok && reserves.balance.ok ? (
          <>
            <div style={{ margin: '14px 0' }}>
              <ReserveGauge supply={reserves.supply.value} balance={reserves.balance.value} lang="en" />
            </div>
            <p style={{ fontWeight: 600, color: short ? 'var(--recusa)' : 'var(--conferido)' }}>
              {short ? (
                <>
                  Short by <Money value={reserves.shortfall ?? '0'} currency="BRL" lang="en" /> of backing.
                </>
              ) : (
                'Match: every tBRL in circulation has a real behind it.'
              )}
            </p>
          </>
        ) : (
          <p className="mudo">Reading supply and balance…</p>
        )}
        <p className="mudo pequeno" style={{ marginTop: 6 }}>
          Pix via {reserves?.provider ?? '…'}.{' '}
          {paused ? (
            <strong style={{ color: 'var(--recusa)' }}>
              tBRL paused{reserves?.pausedAt ? ` at ${dateTime(reserves.pausedAt, 'en')}` : ''}: nothing moves until restored.
            </strong>
          ) : (
            'tBRL working.'
          )}
        </p>

        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 10, marginTop: 16 }}>
          <button
            type="button"
            className="botao botao--secundario"
            disabled={!token || busy !== null}
            onClick={async () => {
              const answer = await call('check', '/api/admin/reserves', { action: 'check' });
              if (answer) setNote({ kind: 'ok', text: 'Checked now.' });
            }}
          >
            Check now
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
                  text: `Minted ${money(String(answer.mintedBrl), 'BRL', 'en')} without backing. The monitor pauses tBRL within 15 s.`,
                  tx: answer.txHash,
                });
              }
            }}
          >
            Break the backing: mint R$ 1,000.00
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
                  text: `Restored: ${money(String(answer.burnedBrl), 'BRL', 'en')} burned and tBRL unpaused.`,
                  tx: answer.burnTx ?? answer.unpauseTx,
                });
              }
            }}
          >
            Restore
          </button>
        </div>
        <p className="pequeno mudo" style={{ marginTop: 10 }}>
          Break mints tBRL to the treasury with no real behind it. Restore unpauses and burns the excess.
        </p>
      </section>

      <section className="secao" aria-labelledby="politica">
        <h2 id="politica">Policy</h2>
        <p className="mudo" style={{ marginTop: 4 }}>
          Tries to send R$ 1.00 of Ana&apos;s tBRL to another wallet. If it is off the policy list, the protocol refuses
          before it hits a block, and the attempt shows up in the Blocked tab of the console.
        </p>
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 10, marginTop: 14, alignItems: 'flex-end' }}>
          <div style={{ flex: '1 1 320px' }}>
            <label className="rotulo" htmlFor="wallet">
              Wallet
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
                    ? { kind: 'ok', text: 'The policy let it through: R$ 1.00 of tBRL sent.', tx: answer.txHash }
                    : { kind: 'erro', text: `Blocked by the protocol: ${answer.reason}` },
                );
              }
            }}
          >
            Try sending R$ 1.00
          </button>
        </div>
      </section>

      <section className="secao" aria-labelledby="pix">
        <h2 id="pix">Pix</h2>
        <p className="mudo" style={{ marginTop: 4 }}>
          The sandbox credential lasts 24 h. When it stops answering, the worker switches to the simulator on its own;
          here you can switch by hand.
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
                if (answer) setNote({ kind: 'ok', text: `New withdrawals go through ${answer.mode}.` });
              }}
            >
              {mode === 'sandbox' ? 'Use the PayZu sandbox' : 'Use the simulator'}
            </button>
          ))}
        </div>
      </section>
    </>
  );
}
