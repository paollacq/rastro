// The integration tests start by dropping the public schema, so they must never be pointed
// at a database anyone cares about. Every place that drops anything calls this first.
//
// Reconstructed here from the team's fix (901999c) so a delivery can't quietly remove it
// again; if their version differs, theirs wins.

const THROWAWAY = /(^|[_-])(test|tests|e2e|scratch|tmp)($|[_-])/i;
const LOCAL = new Set(['localhost', '127.0.0.1', '::1', '[::1]', 'postgres', 'db']);

export function assertThrowawayDatabase(url: string | undefined, what = 'this suite'): string {
  if (!url) throw new Error(`${what} needs a throwaway database URL`);

  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    throw new Error(`${what}: couldn't parse the database URL`);
  }

  const name = decodeURIComponent(parsed.pathname.replace(/^\//, ''));
  if (!THROWAWAY.test(name)) {
    throw new Error(
      `${what} drops the whole schema, so it only runs on a throwaway database. ` +
        `The database "${name}" doesn't look like one: use a name with "test" or "e2e", like rastro_test.`,
    );
  }
  if (!LOCAL.has(parsed.hostname) && process.env.ALLOW_REMOTE_TEST_DATABASE !== 'yes') {
    throw new Error(
      `${what} would drop the schema of "${name}" at ${parsed.hostname}, which is not local. ` +
        'If the database really is throwaway, run with ALLOW_REMOTE_TEST_DATABASE=yes.',
    );
  }
  return url;
}
