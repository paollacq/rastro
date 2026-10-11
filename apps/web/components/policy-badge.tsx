import type { Read } from '@rastro/core';
import type { Lang } from '../lib/format';

// Read from the TIP-403 registry on every render, not from our database: if the wallet
// leaves the policy, the badge says so.
export function PolicyBadge({ identified, policyId, lang }: { identified: Read<boolean>; policyId: string; lang: Lang }) {
  const where = lang === 'pt' ? `política ${policyId} do registro TIP-403` : `policy ${policyId} on the TIP-403 registry`;
  if (!identified.ok) {
    return (
      <span className="selo selo--talvez" title={identified.error}>
        {lang === 'pt' ? 'Política não lida agora' : "Couldn't read the policy"}
      </span>
    );
  }
  return identified.value ? (
    <span className="selo selo--sim" title={where}>
      {lang === 'pt' ? 'Carteira identificada' : 'Identified wallet'}
    </span>
  ) : (
    <span className="selo selo--nao" title={where}>
      {lang === 'pt' ? 'Fora da lista' : 'Not on the list'}
    </span>
  );
}
