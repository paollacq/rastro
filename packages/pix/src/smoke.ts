import { decodeMemo, encodeMemo, endToEndFormat } from './e2e.ts';
import { PayZu, type PixTransaction } from './payzu.ts';

// Run once per fresh sandbox credential. Checks that a charge and a payout both
// settle and that the end-to-end IDs they return fit a TIP-20 memo.
const pix = PayZu.fromEnv();
const stamp = Date.now().toString(36);

console.log('balance before:', JSON.stringify(await pix.balance()));

const inRef = `smoke-in-${stamp}`;
await pix.createCharge(25, inRef);
report('charge', await settle(() => pix.charge(inRef), 'charge'));

// Above R$ 100 the sandbox holds a payout as PENDING for about 10 s, the same
// wait the demo will show on the trail page.
const outRef = `smoke-out-${stamp}`;
await pix.sendPix({ amount: 150, pixKey: 'teste@teste.com', pixType: 'email', clientReference: outRef });
report('payout', await settle(() => pix.payment(outRef), 'payout'));

console.log('balance after: ', JSON.stringify(await pix.balance()));

async function settle(read: () => Promise<PixTransaction>, label: string) {
  const deadline = Date.now() + 40_000;
  for (;;) {
    const tx = await read();
    if (tx.status !== 'PENDING') return tx;
    if (Date.now() > deadline) throw new Error(`${label} still PENDING after 40 s`);
    await new Promise((resolve) => setTimeout(resolve, 2_000));
  }
}

// Two separate checks: the ID has a format we know (official or sandbox), and it goes
// into the memo and comes back unchanged. Only the second one matters for the chain.
function report(label: string, tx: PixTransaction) {
  const id = tx.endToEndId;
  const format = id ? endToEndFormat(id) : null;
  const fits = id !== null && decodeMemo(encodeMemo(id)) === id;
  const shape = format ? `${format} format, ${id?.length} chars` : 'unknown format';
  console.log(
    `${label.padEnd(7)} ${tx.status.padEnd(10)} ${id ?? '(no endToEndId)'}  ${shape}, ${fits ? 'fits the memo' : "doesn't fit the memo"}`,
  );
  if (tx.status !== 'COMPLETED' || !format || !fits) process.exitCode = 1;
}
