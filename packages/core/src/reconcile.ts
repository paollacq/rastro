import type { ChainEvent } from '@rastro/db';
import type { Context } from './context.ts';
import { floorToCents, brlToBase } from './money.ts';
import { operationsCsv } from './report.ts';
import { operationsView } from './views.ts';

// The report is only worth something if every line of it can be found on-chain. This reads
// the CSV back, line by line, and checks each reference against chain_events: the fill that
// converted the dollars, the transfer that sent the tBRL to the treasury, and the burn that
// took it out of circulation with the Pix ID in the memo. Amounts are compared in base
// units, so a centavo of drift is a finding, not a rounding difference.

const ZERO = '0x0000000000000000000000000000000000000000';

export interface Finding {
  line: number;
  operation: string;
  problem: string;
}

export interface Reconciliation {
  lines: number;
  checks: number;
  findings: Finding[];
  ok: boolean;
  csv: string;
}

export async function reconcileReport(ctx: Context, range: { from?: Date; to?: Date } = {}): Promise<Reconciliation> {
  return checkReport(ctx, operationsCsv(await operationsView(ctx, range, 100_000)));
}

// The same checks against a CSV handed in, which is how the tests prove the checks bite.
export async function checkReport(ctx: Context, csv: string): Promise<Reconciliation> {
  const rows = parseCsv(csv);
  const hashes = rows.flatMap((row) => [row.tempo_fill_tx, row.tempo_transfer_tx, row.tempo_burn_tx].filter(Boolean));
  const events = await ctx.db.chainEventsForTxs(hashes);
  const byTx = new Map<string, ChainEvent[]>();
  for (const event of events) {
    const list = byTx.get(event.txHash) ?? [];
    list.push(event);
    byTx.set(event.txHash, list);
  }

  const findings: Finding[] = [];
  let checks = 0;
  rows.forEach((row, i) => {
    const line = i + 2; // the header is line 1
    const name = row.invoice || row.withdrawal_id || row.client_wallet;
    const say = (problem: string) => findings.push({ line, operation: name, problem });
    const of = (hash: string) => byTx.get(hash.toLowerCase()) ?? [];

    if (row.operation === 'conversion') {
      if (!row.tempo_fill_tx) {
        say('conversion without a fill transaction');
      } else {
        checks++;
        const filled = of(row.tempo_fill_tx).find((event) => event.event === 'Filled');
        if (!filled) say(`fill ${row.tempo_fill_tx} is not in chain_events`);
        else if (filled.memoText !== row.invoice) say(`the fill carries memo "${filled.memoText}", not "${row.invoice}"`);
        else if (filled.amount !== base(row.brl_amount)) {
          say(`the fill moved ${reais(filled.amount)} in tBRL, the report says ${row.brl_amount}`);
        } else if (filled.toAddress?.toLowerCase() !== row.client_wallet.toLowerCase()) {
          say(`the fill paid ${filled.toAddress}, the report says ${row.client_wallet}`);
        }
      }
      // The reais on the line have to be what the quote's own formula gives, to the centavo:
      // dollars x PTAX x (1 - spread), rounded down.
      if (row.usd_amount && row.ptax_rate && row.brl_amount) {
        checks++;
        const spread = 10_000n - BigInt(row.spread_bps || 0);
        const expected = floorToCents((BigInt(base(row.usd_amount)) * scaled(row.ptax_rate, 4) * spread) / 100_000_000n);
        if (expected !== BigInt(base(row.brl_amount))) {
          const how = `${row.usd_amount} at PTAX ${row.ptax_rate} less ${Number(row.spread_bps) / 100}%`;
          say(`${how} is ${reais(expected.toString())}, the report says ${row.brl_amount}`);
        }
      }
    }

    if (row.withdrawal_id && row.withdrawal_status !== 'CANCELADO') {
      if (!row.tempo_transfer_tx) {
        say(`${row.withdrawal_id} has no transfer to the treasury`);
      } else {
        checks++;
        const sent = of(row.tempo_transfer_tx).find((e) => e.event === 'TransferWithMemo' && e.memoText === row.withdrawal_id);
        if (!sent) say(`the transfer ${row.tempo_transfer_tx} carries no memo "${row.withdrawal_id}"`);
        else if (sent.amount !== base(row.withdrawn_brl)) {
          say(`the transfer moved ${reais(sent.amount)}, the report says ${row.withdrawn_brl}`);
        }
      }
    }

    if (row.withdrawal_status === 'CONCLUIDO') {
      checks++;
      if (!row.pix_end_to_end_id) say(`${row.withdrawal_id} is done without a Pix ID`);
      else if (!row.tempo_burn_tx) say(`${row.withdrawal_id} is done without a burn`);
      else {
        const burn = of(row.tempo_burn_tx).find((e) => e.event === 'TransferWithMemo' && e.toAddress === ZERO);
        if (!burn) say(`the burn ${row.tempo_burn_tx} is not in chain_events`);
        else if (burn.memoText !== row.pix_end_to_end_id) {
          say(`the burn memo is "${burn.memoText}", the Pix ID is "${row.pix_end_to_end_id}"`);
        } else if (burn.amount !== base(row.withdrawn_brl)) {
          say(`the burn took ${reais(burn.amount)} out, the report says ${row.withdrawn_brl}`);
        }
      }
    }
  });

  return { lines: rows.length, checks, findings, ok: findings.length === 0, csv };
}

const base = (amount: string) => (amount ? brlToBase(amount).toString() : '');

// "5.4123" with 4 decimals -> 54123n
function scaled(value: string, decimals: number): bigint {
  const [whole, fraction = ''] = value.split('.');
  return BigInt(whole + fraction.padEnd(decimals, '0').slice(0, decimals));
}
const reais = (amount: string | null) => (amount ? `R$ ${(Number(amount) / 1e6).toFixed(2)}` : 'nothing');

// Enough CSV for what we write: quoted fields, doubled quotes inside them, CRLF rows.
export function parseCsv(text: string): Record<string, string>[] {
  const body = text.replace(/^﻿/, '');
  const rows: string[][] = [];
  let row: string[] = [];
  let field = '';
  let quoted = false;

  for (let i = 0; i < body.length; i++) {
    const char = body[i];
    if (quoted) {
      if (char !== '"') field += char;
      else if (body[i + 1] === '"') (field += '"'), i++;
      else quoted = false;
    } else if (char === '"') quoted = true;
    else if (char === ',') (row.push(field), (field = ''));
    else if (char === '\n') {
      row.push(field.replace(/\r$/, ''));
      rows.push(row);
      row = [];
      field = '';
    } else field += char;
  }
  if (field || row.length) rows.push([...row, field]);

  const [header, ...lines] = rows.filter((cells) => cells.some((cell) => cell !== ''));
  return lines.map((cells) => Object.fromEntries(header.map((name, i) => [name, cells[i] ?? ''])));
}
