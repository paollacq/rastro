import type { Lang } from '../lib/format';
import { Money } from './money';

// tBRL in circulation against the reais in the Pix account, on one scale. Whatever part of
// the supply has nothing behind it shows in red.
export function ReserveGauge({ supply, balance, lang }: { supply: string; balance: string; lang: Lang }) {
  const s = Number(supply);
  const b = Number(balance);
  const scale = Math.max(s, b) || 1;
  const covered = (Math.min(s, b) / scale) * 100;
  const excess = s > b ? ((s - b) / scale) * 100 : 0;
  return (
    <div className="medidor">
      <span>{lang === 'pt' ? 'tBRL em circulação' : 'tBRL supply'}</span>
      <Money value={supply} currency="BRL" lang={lang} />
      <span className="medidor__barra" aria-hidden="true">
        <span style={{ width: `${covered}%` }} />
        {excess > 0 && <span className="medidor__excesso" style={{ left: `${covered}%`, width: `${excess}%` }} />}
      </span>
      <span>{lang === 'pt' ? 'Reais na conta Pix' : 'BRL in account'}</span>
      <Money value={balance} currency="BRL" lang={lang} />
      <span className="medidor__barra medidor__barra--conta" aria-hidden="true">
        <span style={{ width: `${(b / scale) * 100}%` }} />
      </span>
    </div>
  );
}
