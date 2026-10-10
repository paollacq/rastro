import { readFileSync } from 'node:fs';
import type { Sql } from './client.ts';

// Applies schema.sql. Every statement in it is idempotent.
export async function migrate(db: Sql) {
  const schema = readFileSync(new URL('../schema.sql', import.meta.url), 'utf8');
  await db.unsafe(schema);
}
