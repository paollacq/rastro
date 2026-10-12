import type { StepState } from '@rastro/core/trail';
import type { ReactNode } from 'react';
import type { Lang } from '../lib/format';

// The vertical line with dots, like tracking a parcel: green when done, amber while it is
// happening, red when it was refused, hollow when it hasn't started.

export interface TrilhaItem {
  key: string;
  state: StepState;
  title: ReactNode;
  translation?: ReactNode;
  time?: string | null;
  detail?: ReactNode;
}

const STATE = {
  pt: { feito: 'concluído', agora: 'em andamento', falhou: 'não aconteceu', esperando: 'ainda não aconteceu' },
  en: { feito: 'done', agora: 'in progress', falhou: "didn't happen", esperando: 'not yet' },
} as const;

export function Trilha({ items, lang = 'en', compacta = false }: { items: TrilhaItem[]; lang?: Lang; compacta?: boolean }) {
  return (
    <ol className={compacta ? 'trilha compacta' : 'trilha'}>
      {items.map((item) => (
        <li key={item.key} className={`passo passo--${item.state}`} aria-current={item.state === 'agora' ? 'step' : undefined}>
          <span className="passo__ponto" aria-hidden="true" />
          <div>
            <p className="passo__titulo">
              {item.title}
              <span className="sr-only"> ({STATE[lang][item.state]})</span>
            </p>
            {item.translation && (
              <p className="passo__traducao">
                {item.translation}
              </p>
            )}
          </div>
          {item.time && (
            <p className="passo__hora" suppressHydrationWarning>
              {item.time}
            </p>
          )}
          {item.detail && <div className="passo__detalhe">{item.detail}</div>}
        </li>
      ))}
    </ol>
  );
}
