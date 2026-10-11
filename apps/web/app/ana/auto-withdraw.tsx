'use client';

import { useState } from 'react';
import type { Lang } from '../../lib/format';

// "Sacar automaticamente por Pix": saved on the server, and the worker does the rest for
// every payment that arrives after it was switched on.
export function AutoWithdraw({ on, pixKey, lang }: { on: boolean; pixKey: string; lang: Lang }) {
  const [checked, setChecked] = useState(on);
  const [saving, setSaving] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);

  async function toggle(next: boolean) {
    setChecked(next);
    setSaving(true);
    setProblem(null);
    try {
      const res = await fetch('/api/settings', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ autoWithdraw: next }),
      });
      if (!res.ok) throw new Error((await res.json()).error ?? res.status);
    } catch (error) {
      setChecked(!next);
      setProblem(
        (lang === 'pt' ? 'Não salvou. Tente de novo. ' : "Didn't save. Try again. ") + (error instanceof Error ? error.message : ''),
      );
    } finally {
      setSaving(false);
    }
  }

  return (
    <div>
      <label className="chave">
        <input type="checkbox" checked={checked} disabled={saving} onChange={(e) => void toggle(e.target.checked)} />
        <span>
          <strong>{lang === 'pt' ? 'Sacar automaticamente por Pix' : 'Withdraw by Pix automatically'}</strong>
          <span className="pequeno mudo" style={{ display: 'block' }}>
            {lang === 'pt'
              ? `Cada pagamento que chegar vai direto para a chave ${pixKey}.`
              : `Every payment that arrives goes straight to the key ${pixKey}.`}
          </span>
        </span>
      </label>
      {problem && (
        <p className="pequeno" role="alert" style={{ color: 'var(--recusa)', marginTop: 6 }}>
          {problem}
        </p>
      )}
    </div>
  );
}
