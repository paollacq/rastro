import { existsSync, readFileSync } from 'node:fs';

// The integration suites start by dropping the public schema. Pointed at the database the
// app uses, they wipe it: invoices, withdrawals, the watcher's cursor, everything. So check
// before the first statement runs, and say which variable to change.
//
// vitest doesn't load the root .env into process.env, so read DATABASE_URL out of the file
// ourselves. Reading it, rather than loading it, keeps the suite's own environment alone.

export function assertThrowawayDatabase(url: string, variable: string): void {
  const app = appDatabaseUrl();
  if (app && sameDatabase(app, url)) {
    throw new Error(
      `${variable} points at ${target(url)}, the database DATABASE_URL uses. This suite drops ` +
        'the public schema, so it would wipe the app. Point it at a throwaway database instead.',
    );
  }
}

function appDatabaseUrl(): string | undefined {
  if (process.env.DATABASE_URL) return process.env.DATABASE_URL;
  const rootEnv = new URL('../../../.env', import.meta.url);
  if (!existsSync(rootEnv)) return undefined;
  try {
    return /^DATABASE_URL=(.*)$/m.exec(readFileSync(rootEnv, 'utf8'))?.[1].trim() || undefined;
  } catch {
    return undefined;
  }
}

// Host, port and database name: the same database reached with different credentials is
// still the same database.
const sameDatabase = (a: string, b: string) => target(a) === target(b);

function target(url: string): string {
  try {
    const parsed = new URL(url);
    return `${parsed.hostname}:${parsed.port || '5432'}${parsed.pathname}`;
  } catch {
    return url;
  }
}
