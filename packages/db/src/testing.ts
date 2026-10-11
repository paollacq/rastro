// The integration tests start by dropping the public schema, so they must never be pointed
// at a database anyone cares about. Every place that drops anything calls this first.
//
// Reconstructed here from the team's fix (901999c) so a delivery can't quietly remove it
// again; if their version differs, theirs wins.

const THROWAWAY = /(^|[_-])(test|tests|e2e|scratch|tmp)($|[_-])/i;
const LOCAL = new Set(['localhost', '127.0.0.1', '::1', '[::1]', 'postgres', 'db']);

export function assertThrowawayDatabase(url: string | undefined, what = 'esta suíte'): string {
  if (!url) throw new Error(`${what} precisa de uma URL de banco descartável`);

  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    throw new Error(`${what}: não entendi a URL do banco`);
  }

  const name = decodeURIComponent(parsed.pathname.replace(/^\//, ''));
  if (!THROWAWAY.test(name)) {
    throw new Error(
      `${what} apaga o schema inteiro, então só roda em banco descartável. ` +
        `O banco "${name}" não parece um: use um nome com "test" ou "e2e", como rastro_test.`,
    );
  }
  if (!LOCAL.has(parsed.hostname) && process.env.ALLOW_REMOTE_TEST_DATABASE !== 'yes') {
    throw new Error(
      `${what} ia apagar o schema de "${name}" em ${parsed.hostname}, que não é local. ` +
        'Se o banco é mesmo descartável, rode com ALLOW_REMOTE_TEST_DATABASE=yes.',
    );
  }
  return url;
}
