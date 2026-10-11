// The demo's cast, from the spec: Ana Ribeiro (fictional backend dev in Recife), the payer
// Bramble & Pike Software, Inc. (fictional, Austin) and invoice #0047. Safe to run again.
// `pnpm demo:reset` does this and the chain side too, before a recording.
import { account } from '@rastro/chain';
import { connect, migrate, queries } from '@rastro/db';
import { seedCast } from '../demo.ts';

const db = connect(undefined, { max: 1 });
await migrate(db);
await seedCast(queries(db));

console.log(`Ana          ${account('ana').address}
Bramble&Pike ${account('payer').address}
fatura-0047  US$ 1,540.00, open`);
await db.end();
