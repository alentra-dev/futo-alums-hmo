import { spawn } from 'node:child_process';
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { runMonitor, SCHEDULE } from './check';
import { loadMonitorEnvironment, readAccessFile } from './local-config';

const worker = 'futo-hmo-supabase-monitor';
const config = 'ops/supabase-monitor/wrangler.json';

async function main() {
  const access = readAccessFile();
  const account = process.env.CLOUDFLARE_ACCOUNT_ID ?? access.CLOUDFLARE_ACCOUNT_ID;
  const token = process.env.CLOUDFLARE_API_TOKEN ?? access.CLOUDFLARE_API_TOKEN;
  if (!account || !/^[a-f0-9]{32}$/i.test(account) || !token) throw new Error('Cloudflare account ID and API token are required in .private/cloudflare-access.env.');
  const env = loadMonitorEnvironment();
  if (!env.HEALTHCHECKS_PING_URL) throw new Error('Configure the independent heartbeat and project-email notification before deployment.');
  const preflight = await runMonitor(env);
  console.log(JSON.stringify({ stage: 'preflight', ...preflight }));
  if (!preflight.ok) throw new Error('Database and independent heartbeat must both pass preflight.');

  const api = async (path: string): Promise<any> => {
    const response = await fetch(`https://api.cloudflare.com/client/v4/accounts/${account}/workers/scripts/${worker}/${path}`, {
      headers: { Authorization: `Bearer ${token}` }, signal: AbortSignal.timeout(20_000), redirect: 'error',
    });
    if (!response.ok) throw new Error(`Cloudflare verification failed (HTTP ${response.status}).`);
    const payload = await response.json() as { success: boolean; result: unknown };
    if (!payload.success) throw new Error('Cloudflare did not confirm verification.');
    return payload.result;
  };

  if (!process.argv.includes('--verify-only')) {
    mkdirSync('.private', { recursive: true });
    const directory = mkdtempSync('.private/monitor-bindings-');
    const secretFile = resolve(directory, 'bindings.json');
    writeFileSync(secretFile, JSON.stringify(env), { mode: 0o600 });
    try {
      const log: Buffer[] = [];
      const exitCode = await new Promise<number | null>((resolveExit, reject) => {
        const child = spawn(process.execPath, [resolve('node_modules/wrangler/bin/wrangler.js'), 'deploy', '--config', config, '--secrets-file', secretFile, '--strict'], {
          env: { ...process.env, CLOUDFLARE_ACCOUNT_ID: account, CLOUDFLARE_API_TOKEN: token, WRANGLER_SEND_METRICS: 'false', CI: 'true' }, stdio: ['ignore', 'pipe', 'pipe'],
        });
        child.stdout.on('data', data => log.push(Buffer.from(data)));
        child.stderr.on('data', data => log.push(Buffer.from(data)));
        child.on('error', reject);
        child.on('exit', resolveExit);
      });
      writeFileSync('.private/monitor-deploy.log', Buffer.concat(log), { mode: 0o600 });
      if (exitCode !== 0) throw new Error('Worker deployment failed. Inspect the owner-readable .private/monitor-deploy.log.');
    } finally { rmSync(directory, { recursive: true, force: true }); }
  }

  const [schedules, settings, subdomain] = await Promise.all([api('schedules'), api('settings'), api('subdomain')]);
  if (schedules.schedules?.length !== 1 || schedules.schedules[0].cron !== SCHEDULE) throw new Error('Deployed schedule differs from the four-daily-check configuration.');
  const names = new Set((settings.bindings ?? []).filter((binding: any) => binding.type === 'secret_text').map((binding: any) => binding.name));
  if (!names.has('SUPABASE_PUBLISHABLE_KEY') || !names.has('HEALTHCHECKS_PING_URL')) throw new Error('Worker secret bindings were not confirmed.');
  if (subdomain.enabled || subdomain.previews_enabled) throw new Error('The monitor must have no public workers.dev or preview endpoint.');
  writeFileSync('.private/monitor-deployment.json', JSON.stringify({ verifiedAt: new Date().toISOString(), worker, schedule: SCHEDULE, secretBindings: [...names], publicHttpEnabled: false }, null, 2), { mode: 0o600 });
  console.log(JSON.stringify({ stage: 'deployment_verified', worker, scheduleUtc: SCHEDULE, publicHttpEnabled: false }));
  console.log('Next: verify an actual Cloudflare Cron event and its success heartbeat before claiming scheduled operation is proven.');
}

try { await main(); } catch (error) {
  // The exceptions we construct contain no credentials; upstream exceptions can contain URLs.
  const message = error instanceof Error && /^(Cloudflare |Configure |Database |Worker |Deployed |The monitor)/.test(error.message)
    ? error.message : 'Monitor setup failed; inspect private configuration and deployment logs.';
  console.error(message);
  process.exitCode = 1;
}
