'use client';

import { useState, type FormEvent } from 'react';
import { Erro } from '../components/erro';

const OPTIONS = [
  { value: 'recebo', label: 'I receive' },
  { value: 'pago', label: 'I pay' },
  { value: 'os dois', label: 'Both' },
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
        body: JSON.stringify({ email: form.get('email'), relation: form.get('relation'), lang: 'en' }),
      });
      const body = await res.json();
      if (!res.ok) {
        setState({ kind: 'erro', message: body.error ? `Couldn't join the list: ${body.error}.` : "Couldn't join the list. Try again." });
        return;
      }
      setState({ kind: 'feito', added: body.added });
    } catch {
      setState({ kind: 'erro', message: "Couldn't reach the server. Try again in a few seconds." });
    }
  }

  if (state.kind === 'feito') {
    return (
      <p role="status" style={{ fontWeight: 600 }}>
        {state.added ? "You're on the list. We'll email when it opens." : "That email was already on the list. We'll email when it opens."}
      </p>
    );
  }

  return (
    <form onSubmit={submit} noValidate={false} style={{ display: 'grid', gap: 16, maxWidth: 480 }}>
      <div>
        <label className="rotulo" htmlFor="email">
          Email
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
          Do you receive or pay in dollars? <span className="mudo" style={{ fontWeight: 400 }}>(optional)</span>
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
          Join the list
        </button>
      </div>
    </form>
  );
}
