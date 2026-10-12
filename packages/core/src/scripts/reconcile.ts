// Checks the CSV the console exports against what is on the chain, line by line.
//
//   pnpm relatorio:conferir                         every operation
//   pnpm relatorio:conferir --from 2026-10-01       from that day (Brasilia), inclusive
//   pnpm relatorio:conferir --to 2026-10-31 --csv   also writes the file it checked
import { writeFileSync } from 'node:fs';
import { parseArgs } from 'node:util';
import { createContext } from '../context.ts';
import { brazilDate } from '../ptax.ts';
import { reconcileReport } from '../reconcile.ts';

const { values: opts } = parseArgs({
  options: {
    from: { type: 'string' },
    to: { type: 'string' },
    csv: { type: 'boolean', default: false },
  },
});

const day = (value: string | undefined, plusDays: number) =>
  value ? new Date(new Date(`${value}T00:00:00-03:00`).getTime() + plusDays * 86_400_000) : undefined;

const ctx = createContext();
const result = await reconcileReport(ctx, { from: day(opts.from, 0), to: day(opts.to, 1) });

if (opts.csv) {
  const name = `rastro-operacoes-${brazilDate(new Date())}.csv`;
  writeFileSync(name, `﻿${result.csv}`);
  console.log(`${name} written\n`);
}

console.log(`${result.lines} ${result.lines === 1 ? 'line' : 'lines'}, ${result.checks} checks against chain_events\n`);
for (const finding of result.findings) {
  console.log(`line ${finding.line}  ${finding.operation}\n  ${finding.problem}`);
}
console.log(
  result.ok
    ? 'OK: every line matches the chain.'
    : `\n${result.findings.length} ${result.findings.length === 1 ? 'line does not match' : 'lines do not match'} the chain.`,
);
if (!result.ok) process.exitCode = 1;
await ctx.db.sql.end();
