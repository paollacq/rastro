// Prints the PTAX the quotes will use, and the URL it came from, so the first call to the
// Central Bank can be checked by eye.
import { brazilDate, latestPtax, ptaxUrl } from '../ptax.ts';

const now = new Date();
console.log(`today in Brazil  ${brazilDate(now)}`);
console.log(`url              ${ptaxUrl(now)}`);
const ptax = await latestPtax({ now });
console.log(`PTAX (compra)    ${ptax.rate} on ${ptax.date}  [${ptax.source}]`);
