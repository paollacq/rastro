import { dateTime } from '../lib/format';

// VERIFIED, with the real date and time of the burn. It lands once, with a short thud,
// after the ID has lit up; with reduced motion it is simply there.
export function Carimbo({ at, entra = true }: { at: string | null; entra?: boolean }) {
  return (
    <p className={entra ? 'carimbo carimbo--entra' : 'carimbo'} role="img" aria-label={at ? `Verified at ${dateTime(at, 'en')}` : 'Verified'}>
      <span className="carimbo__palavra" aria-hidden="true">
        VERIFIED
      </span>
      {at && (
        <span className="carimbo__data" aria-hidden="true" suppressHydrationWarning>
          {dateTime(at, 'en')}
        </span>
      )}
    </p>
  );
}
