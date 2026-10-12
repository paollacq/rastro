import Link from 'next/link';

// "rastro" and a trail of three dots out of the last o. The team draws the real one; this
// stand-in only fixes its proportions and color.
export function Marca({ grande = false, rotulo = 'rastro, home' }: { grande?: boolean; rotulo?: string }) {
  return (
    <Link href="/" className={grande ? 'marca marca--grande' : 'marca'} aria-label={rotulo}>
      rastro
      <svg viewBox="0 0 21 10" aria-hidden="true">
        <circle cx="3" cy="5" r="2.3" fill="var(--carimbo)" />
        <circle cx="10.5" cy="5" r="2" fill="var(--carimbo)" opacity="0.65" />
        <circle cx="18" cy="5" r="1.7" fill="var(--carimbo)" opacity="0.35" />
      </svg>
    </Link>
  );
}
