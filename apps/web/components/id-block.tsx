import type { Comparison } from '@rastro/core/trail';
import type { CSSProperties } from 'react';
import { short } from '../lib/format';
import { Carimbo } from './carimbo';

// The Pix ID over the memo the burn carried, in four groups of eight: a TIP-20 memo is 32
// bytes, and an official Pix ID is 32 characters. Each pair lights up from left to right,
// then the stamp lands. A sandbox ID (20 characters) leaves the last 12 bytes empty, and
// the screen shows them empty.

const MEMO_BYTES = 32;

export function Comparacao({ comparison, explorer }: { comparison: Comparison; explorer: string }) {
  const { pixId, memo, memoHex, equal, length, matches, format, provider } = comparison;
  return (
    <div className={`comparacao ${matches ? 'comparacao--conferida' : 'comparacao--diferente'}`}>
      <IdLinha rotulo="ID do Pix" traducao="Pix ID" texto={pixId} outro={memo} />
      <IdLinha rotulo="Memo no Tempo" traducao="Memo on Tempo" texto={memo} outro={pixId} />
      <div className="comparacao__fim">
        <div>
          <p style={matches ? undefined : { color: 'var(--recusa)' }}>
            <strong>
              {equal} de {length} caracteres iguais{matches ? '' : ': o memo não bate com o ID do Pix, então não há carimbo'}
            </strong>
            <span className="mudo" lang="en" style={{ display: 'block' }}>
              {equal} of {length} characters match
            </span>
          </p>
          <p className="pequeno mudo" style={{ marginTop: 8 }}>
            {provider === 'simulator'
              ? 'ID simulado, no formato oficial, de uma instituição fictícia (99999999). '
              : format === 'sandbox'
                ? 'ID do sandbox da PayZu, com 20 caracteres; um ID de Pix de verdade tem 32 e ocupa o memo inteiro. '
                : ''}
            {memoHex && (
              <>
                O memo, como está no bloco:{' '}
                <a className="mono" href={`${explorer}/tx/${comparison.burnTx}`} target="_blank" rel="noreferrer" title={memoHex}>
                  {short(memoHex, 8)}
                </a>
              </>
            )}
          </p>
        </div>
        {matches && <Carimbo at={comparison.at} />}
      </div>
    </div>
  );
}

function IdLinha({ rotulo, traducao, texto, outro }: { rotulo: string; traducao: string; texto: string; outro: string }) {
  const cells = Array.from({ length: MEMO_BYTES }, (_, i) => texto[i] ?? null);
  return (
    <div className="id-linha">
      <p className="id-linha__rotulo">
        {rotulo}
        <br />
        <span className="mudo" lang="en">
          {traducao}
        </span>
      </p>
      <p className="id-bloco">
        <span className="sr-only">{texto}</span>
        {[0, 8, 16, 24].map((start) => (
          <span className="id-bloco__grupo" key={start} aria-hidden="true">
            {cells.slice(start, start + 8).map((c, j) => {
              const i = start + j;
              const kind = c === null ? ' id-bloco__c--vazio' : c !== outro[i] ? ' id-bloco__c--diferente' : '';
              return (
                <span key={i} className={`id-bloco__c${kind}`} style={{ '--i': i } as CSSProperties}>
                  {c ?? '·'}
                </span>
              );
            })}
          </span>
        ))}
      </p>
    </div>
  );
}
