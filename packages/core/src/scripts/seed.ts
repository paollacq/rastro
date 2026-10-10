// The demo's cast, from the spec: Ana Ribeiro (fictional backend dev in Recife), the payer
// Bramble & Pike Software, Inc. (fictional, Austin) and invoice #0047. Safe to run again.
import { account } from '@rastro/chain';
import { connect, migrate, queries } from '@rastro/db';

const db = connect(undefined, { max: 1 });
await migrate(db);
const q = queries(db);

const ana = account('ana');
const payer = account('payer');

await q.upsertUser({
  id: 'ana',
  role: 'recebedora',
  name: 'Ana Ribeiro',
  wallet: ana.address,
  // A test key on a reserved domain: it can never belong to a real person.
  pixKey: 'ana.ribeiro@example.com',
  pixKeyType: 'email',
  pixKeyMasked: 'a•••@example.com',
  kycStatus: 'aprovado',
});
await q.upsertUser({ id: 'bramble-pike', role: 'pagador', name: 'Bramble & Pike Software, Inc.', wallet: payer.address });
await q.upsertInvoice({
  id: 'fatura-0047',
  number: '0047',
  payerName: 'Bramble & Pike Software, Inc.',
  payerWallet: payer.address,
  recipientId: 'ana',
  description: 'Backend, setembro: 28 h × US$ 55',
  amountUsd: '1540.00',
});

console.log(`Ana          ${ana.address}
Bramble&Pike ${payer.address}
fatura-0047  US$ 1,540.00, open`);
await db.end();
