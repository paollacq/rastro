import type { OperationRow } from './views.ts';

// "Export report (CSV)" on the console: one line per operation, with who sent the money,
// who got it, at what rate, and every Pix and Tempo reference along the way. It covers the
// origin and destination data BCB Res. 521 asks institutions to keep; it is not the
// official filing layout. Plain RFC 4180, dot decimals, times in Brasilia with the offset.

const COLUMNS = [
  'time_brt',
  'operation',
  'client_name',
  'client_cpf',
  'client_wallet',
  'client_pix_key',
  'payer_name',
  'payer_wallet',
  'invoice',
  'usd_amount',
  'ptax_date',
  'ptax_rate',
  'spread_bps',
  'rate_applied',
  'brl_amount',
  'withdrawal_id',
  'withdrawal_status',
  'withdrawn_brl',
  'pix_end_to_end_id',
  'pix_provider',
  'tempo_fill_tx',
  'tempo_transfer_tx',
  'tempo_burn_tx',
] as const;

export function operationsCsv(rows: OperationRow[]): string {
  const lines = rows.map((op) =>
    [
      brasiliaTime(op.at),
      op.kind === 'conversao' ? 'conversion' : 'withdrawal',
      op.client.name,
      op.client.cpfMasked,
      op.client.wallet,
      op.client.pixKeyMasked,
      op.invoice?.payerName,
      op.invoice?.payerWallet,
      op.invoice?.id,
      op.usd,
      op.ptax?.date,
      op.ptax?.rate,
      op.ptax?.spreadBps,
      op.rate,
      op.brl,
      op.withdrawal?.id,
      op.withdrawal?.status,
      op.withdrawal?.amountBrl,
      op.withdrawal?.e2eId,
      op.withdrawal?.provider,
      op.fillTx,
      op.transferTx,
      op.burnTx,
    ]
      .map(field)
      .join(','),
  );
  return `${[COLUMNS.join(','), ...lines].join('\r\n')}\r\n`;
}

function field(value: string | number | null | undefined): string {
  if (value === null || value === undefined) return '';
  const text = String(value);
  return /[",\r\n]/.test(text) ? `"${text.replaceAll('"', '""')}"` : text;
}

// "2026-10-10T21:25:39.000Z" -> "2026-10-10T18:25:39-03:00"
export function brasiliaTime(iso: string): string {
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat('en-US', {
      timeZone: 'America/Sao_Paulo',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
      hourCycle: 'h23',
      timeZoneName: 'longOffset',
    })
      .formatToParts(new Date(iso))
      .map((part) => [part.type, part.value]),
  );
  const offset = parts.timeZoneName === 'GMT' ? '+00:00' : parts.timeZoneName.replace('GMT', '');
  return `${parts.year}-${parts.month}-${parts.day}T${parts.hour}:${parts.minute}:${parts.second}${offset}`;
}
