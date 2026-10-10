import postgres from 'postgres';

export type Sql = postgres.Sql;

// Columns come back camelCased and objects passed to sql(...) go in snake_cased.
// Numerics and bigints come back as strings; the caller turns them into bigint.
export function connect(url = process.env.DATABASE_URL, options: { max?: number } = {}): Sql {
  if (!url) throw new Error('DATABASE_URL is missing from .env');
  const local = /@(localhost|127\.0\.0\.1)[:/]/.test(url);
  return postgres(url, {
    transform: postgres.camel,
    ssl: local ? false : 'require',
    // Supabase's pooler (port 6543) runs in transaction mode, which can't keep prepared statements.
    prepare: false,
    max: options.max ?? 5,
    idle_timeout: 20,
    onnotice: () => {},
  });
}

let shared: Sql | undefined;

// One pool per process.
export const sql = () => (shared ??= connect());
