'use client';

import { useState, type FormEvent } from 'react';
import { Erro } from '../components/erro';

const OPTIONS = [
  { value: 'recebo', label: 'Recebo' },
  { value: 'pago', label: 'Pago' },
  { value: 'os dois', label: 'Os dois' },
] as const;

// E-mail plus an optional question; stored in Postgres (table waitlist).
export function WaitlistForm() {
  const [state, setState] = useState<{ kind: 'aberto' } | { kind: 'enviando' } | { kind: 'feito'; added: boolean } | { kind: 'erro'; message: string }>({
    kind: 'aberto',
  });

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    setState({ kind: 'enviando' });
    try {
      const res = await fetch('/api/waitlist', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ email: form.get('email'), relation: form.get('relation'), lang: 'pt' }),
      });
      const body = await res.json();
      if (!res.ok) {
        setState({ kind: 'erro', message: body.error ? `Não entrou na lista: ${body.error}.` : 'Não entrou na lista. Tente de novo.' });
        return;
      }
      setState({ kind: 'feito', added: body.added });
    } catch {
      setState({ kind: 'erro', message: 'Não deu para falar com o servidor. Tente de novo em alguns segundos.' });
    }
  }

  if (state.kind === 'feito') {
    return (
      <p role="status" style={{ fontWeight: 600 }}>
        {state.added ? 'Pronto, você está na lista. A gente avisa quando abrir.' : 'Esse e-mail já estava na lista. A gente avisa quando abrir.'}
      </p>
    );
  }

  return (
    <form onSubmit={submit} noValidate={false} style={{ display: 'grid', gap: 16, maxWidth: 480 }}>
      <div>
        <label className="rotulo" htmlFor="email">
          E-mail
        </label>
        <input
          className="campo"
          id="email"
          name="email"
          type="email"
          autoComplete="email"
          required
          maxLength={254}
          aria-invalid={state.kind === 'erro' ? true : undefined}
        />
      </div>
      <fieldset style={{ border: 0, padding: 0, margin: 0 }}>
        <legend className="rotulo">
          Você recebe ou paga em dólar? <span className="mudo" style={{ fontWeight: 400 }}>(opcional)</span>
        </legend>
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: '8px 20px' }}>
          {OPTIONS.map((option) => (
            <label key={option.value} style={{ display: 'inline-flex', gap: 8, alignItems: 'center', cursor: 'pointer' }}>
              <input type="radio" name="relation" value={option.value} style={{ accentColor: 'var(--carimbo)', width: 18, height: 18 }} />
              {option.label}
            </label>
          ))}
        </div>
      </fieldset>
      {state.kind === 'erro' && <Erro>{state.message}</Erro>}
      <div>
        <button type="submit" className="botao" disabled={state.kind === 'enviando'} aria-busy={state.kind === 'enviando'}>
          Entrar na lista
        </button>
      </div>
    </form>
  );
}
