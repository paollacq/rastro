import type { ReactNode } from 'react';

// The receipt: a lighter slip with a header line and a perforated bottom edge (CSS only).
export function Comprovante({ esquerda, direita, children }: { esquerda?: ReactNode; direita?: ReactNode; children: ReactNode }) {
  return (
    <section className="comprovante">
      {(esquerda || direita) && (
        <div className="comprovante__cabeca">
          <span>{esquerda}</span>
          <span>{direita}</span>
        </div>
      )}
      {children}
    </section>
  );
}
