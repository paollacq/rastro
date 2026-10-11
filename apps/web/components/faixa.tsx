import type { Lang } from '../lib/format';

// Always on screen, so nobody mistakes the demo for real money, and always saying which Pix
// is behind it (spec: "Pix simulado" when the sandbox credential is not in use).
export function Faixa({ lang, mode }: { lang: Lang; mode: 'sandbox' | 'simulator' }) {
  const text =
    lang === 'pt'
      ? `Tempo testnet · ${mode === 'sandbox' ? 'Pix em sandbox' : 'Pix simulado'} · nenhum dinheiro real`
      : `Tempo testnet · ${mode === 'sandbox' ? 'Pix sandbox' : 'simulated Pix'} · no real money`;
  return <p className="faixa">{text}</p>;
}
