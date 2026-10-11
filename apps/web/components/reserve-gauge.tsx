import type { Lang } from '../lib/format';
import { Money } from './money';

// tBRL in circulation against the reais behind it, on one scale. Whatever part of the
// supply has nothing behind it shows in red. A Pix already paid out whose tBRL has not been
// burned yet counts as backing: for those few seconds the money is gone from the account
// and the token has not caught up.
export function ReserveGauge({
  supply,
  balance,
  inFlight = '0.00',
  inFlightCount = 0,
  lang,
}: {
  supply: string;
  balance: string;
  inFlight?: string;
  inFlightCount?: number;
  lang: Lang;
}) {
  const s = Number(supply);
  const b = Number(balance) + Number(inFlight);
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
      <span>
        {lang === 'pt' ? 'Reais na conta Pix' : 'BRL in account'}
        {Number(inFlight) > 0 && (
          <span className="mudo" style={{ display: 'block', fontSize: 'var(--t13)' }}>
            {lang === 'pt' ? 'mais em trânsito' : 'plus on its way out'} {inFlight}
            {inFlightCount > 0 && (lang === 'pt' ? ` (${inFlightCount} saque${inFlightCount > 1 ? 's' : ''})` : ` (${inFlightCount})`)}
          </span>
        )}
      </span>
      <Money value={(Number(balance) + Number(inFlight)).toFixed(2)} currency="BRL" lang={lang} />
      <span className="medidor__barra medidor__barra--conta" aria-hidden="true">
        <span style={{ width: `${(b / scale) * 100}%` }} />
      </span>
    </div>
  );
}
