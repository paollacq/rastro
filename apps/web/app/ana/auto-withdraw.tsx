'use client';

import { useState } from 'react';

// "Withdraw by Pix automatically": saved on the server, and the worker does the rest for
// every payment that arrives after it was switched on.
export function AutoWithdraw({ on, pixKey }: { on: boolean; pixKey: string }) {
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
      setProblem("Didn't save. Try again. " + (error instanceof Error ? error.message : ''));
    } finally {
      setSaving(false);
    }
  }

  return (
    <div>
      <label className="chave">
        <input type="checkbox" checked={checked} disabled={saving} onChange={(e) => void toggle(e.target.checked)} />
        <span>
          <strong>Withdraw by Pix automatically</strong>
          <span className="pequeno mudo" style={{ display: 'block' }}>
            {`Every payment that arrives goes straight to the key ${pixKey}.`}
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
