import { short, type Lang } from '../lib/format';

// A shortened hash or address, linked to the Moderato explorer.
export function TxLink({
  hash,
  explorer,
  lang = 'en',
  kind = 'tx',
}: {
  hash: string;
  explorer: string;
  lang?: Lang;
  kind?: 'tx' | 'address';
}) {
  const where = 'opens in the Tempo explorer';
  void lang;
  return (
    <a className="mono tx" href={`${explorer}/${kind}/${hash}`} target="_blank" rel="noreferrer" title={hash}>
      {short(hash)}
      <svg width="9" height="9" viewBox="0 0 10 10" aria-hidden="true" style={{ marginLeft: 3, verticalAlign: '0.05em' }}>
        <path d="M3.5 1.5h5v5M8.5 1.5 1.5 8.5" fill="none" stroke="currentColor" strokeWidth="1.2" />
      </svg>
      <span className="sr-only"> ({where})</span>
    </a>
  );
}
