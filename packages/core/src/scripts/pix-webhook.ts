// Registers the app's webhook with the PayZu sandbox and prints its secret, once.
//
//   pnpm pix:webhook https://<your-app>/api/webhooks/pix
//
// The sandbox only delivers after the URL answers its ownership challenge, so the app has
// to be up at that address first (a deploy, or a tunnel to localhost). Then put the secret
// in PAYZU_WEBHOOK_SECRET wherever the app runs. Running it again shows the status.
import { PayZu } from '@rastro/pix';

const url = process.argv[2];
if (!url?.startsWith('https://')) {
  console.error('usage: pnpm pix:webhook https://<public address>/api/webhooks/pix');
  process.exit(1);
}

const api = PayZu.fromEnv();
const existing = (await api.webhooks()).find((hook) => hook.url === url);
let webhookId: string;

if (existing) {
  webhookId = existing.id;
  console.log(`already registered (${existing.id}), secret ${existing.hasSecret ? 'set' : 'missing'}`);
} else {
  const created = await api.createWebhook(url);
  webhookId = created.id;
  console.log(`registered ${created.id}\n\nPAYZU_WEBHOOK_SECRET=${created.secret}\n\nThe secret is shown only this once.`);
}

for (let attempt = 0; attempt < 10; attempt++) {
  const check = await api.challenge(webhookId);
  console.log(`challenge  ${check.status}${check.detail ? `: ${check.detail}` : ''}`);
  if (check.status === 'verified') process.exit(0);
  if (check.status === 'failed') {
    console.log('the app did not answer; fix the URL or the deploy, then this retries the challenge');
    await api.retryChallenge(webhookId);
  }
  await new Promise((resolve) => setTimeout(resolve, 2_000));
}
console.log('not verified yet; run this again in a minute');
