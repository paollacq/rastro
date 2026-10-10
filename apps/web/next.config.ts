import type { NextConfig } from 'next';
import { existsSync } from 'node:fs';

// Locally the whole monorepo shares the .env at its root. On Vercel the variables come
// from the project settings and this file doesn't exist.
const rootEnv = new URL('../../.env', import.meta.url);
if (existsSync(rootEnv)) process.loadEnvFile(rootEnv);

const config: NextConfig = {
  // The workspace packages ship TypeScript source.
  transpilePackages: ['@rastro/core', '@rastro/chain', '@rastro/db', '@rastro/pix'],
  // Keep the Postgres driver as a plain Node dependency.
  serverExternalPackages: ['postgres'],
};

export default config;
