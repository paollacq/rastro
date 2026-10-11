import type { ReactNode } from 'react';

// What happened and what to do, with the technical reason on its own line.
export function Erro({ children, motivo }: { children: ReactNode; motivo?: string | null }) {
  return (
    <div className="erro" role="alert">
      <p>{children}</p>
      {motivo && <p className="erro__motivo">{motivo}</p>}
    </div>
  );
}
