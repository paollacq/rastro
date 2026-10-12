import { AppError, brazilDate, operationsCsv, operationsView } from '@rastro/core';
import { context } from '../../../lib/api';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

// GET /api/report.csv?from=2026-10-01&to=2026-10-31, days in Brasília time, both ends
// included. Without them, every operation.
export async function GET(request: Request) {
  const params = new URL(request.url).searchParams;
  try {
    const from = day(params.get('from'), 0);
    const to = day(params.get('to'), 1);
    const csv = operationsCsv(await operationsView(context(), { from, to }, 100_000));
    const name = `rastro-operations-${brazilDate(new Date())}.csv`;
    return new Response(`﻿${csv}`, {
      headers: {
        'content-type': 'text/csv; charset=utf-8',
        'content-disposition': `attachment; filename="${name}"`,
        'cache-control': 'no-store',
      },
    });
  } catch (error) {
    if (error instanceof AppError) return Response.json({ error: error.message, code: error.code }, { status: error.status });
    console.error(error);
    return Response.json({ error: "couldn't build the report right now", code: 'internal' }, { status: 500 });
  }
}

// "2026-10-31" -> midnight in Brasília, plus `extraDays` (1 makes the end inclusive).
function day(value: string | null, extraDays: number): Date | undefined {
  if (!value) return undefined;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) throw new AppError(400, 'use dates like 2026-10-31', 'bad_request');
  const date = new Date(`${value}T00:00:00-03:00`);
  if (Number.isNaN(date.getTime())) throw new AppError(400, `invalid date: ${value}`, 'bad_request');
  return new Date(date.getTime() + extraDays * 86_400_000);
}
