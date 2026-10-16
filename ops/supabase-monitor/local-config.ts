import { existsSync, readFileSync, statSync } from 'node:fs';
import { parseEnv } from 'node:util';
import { SUPABASE_URL, type MonitorEnvironment } from './check';

export function readAccessFile(): Record<string, string | undefined> {
  const path = '.private/cloudflare-access.env';
  if (!existsSync(path)) return {};
  if (statSync(path).mode & 0o077) throw new Error(`Restrict ${path} to its owner with chmod 600.`);
  return parseEnv(readFileSync(path, 'utf8'));
}

export function loadMonitorEnvironment(): MonitorEnvironment {
  const local = existsSync('.env.local') ? parseEnv(readFileSync('.env.local', 'utf8')) : {};
  if (local.VITE_SUPABASE_URL && local.VITE_SUPABASE_URL !== SUPABASE_URL) throw new Error('Local Supabase URL differs from the intended production project.');
  const access = readAccessFile();
  return {
    SUPABASE_PUBLISHABLE_KEY: process.env.SUPABASE_PUBLISHABLE_KEY ?? local.VITE_SUPABASE_ANON_KEY ?? '',
    HEALTHCHECKS_PING_URL: process.env.HEALTHCHECKS_PING_URL ?? access.HEALTHCHECKS_PING_URL,
  };
}
