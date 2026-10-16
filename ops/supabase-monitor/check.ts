export const SUPABASE_URL = 'https://dkfilwifdkyifsyzomox.supabase.co';
export const SCHEDULE = '17 1,7,13,19 * * *';

export interface MonitorEnvironment {
  SUPABASE_PUBLISHABLE_KEY: string;
  HEALTHCHECKS_PING_URL?: string;
}

type FailureReason = 'configuration' | 'network_or_timeout' | 'http_error' | 'invalid_response';
export interface ProbeResult {
  ok: boolean;
  attempts: number;
  durationMs: number;
  reason?: FailureReason;
  httpStatus?: number;
}
export interface MonitorResult {
  ok: boolean;
  probe: ProbeResult;
  heartbeat: 'delivered' | 'failed' | 'not_configured';
}
interface Dependencies {
  fetch: typeof fetch;
  sleep: (milliseconds: number) => Promise<void>;
  now: () => number;
}
const defaults: Dependencies = {
  fetch: (...args) => fetch(...args),
  sleep: (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds)),
  now: () => Date.now(),
};

// Never accept a service-role/secret key for this public, read-only probe.
function publicKeyValid(value: unknown): value is string {
  return typeof value === 'string' && /^sb_publishable_[A-Za-z0-9_-]+$/.test(value);
}

function joinConfigValid(value: unknown): boolean {
  if (!value || typeof value !== 'object') return false;
  const config = value as Record<string, unknown>;
  if (typeof config.acceptingApplications !== 'boolean' || !Array.isArray(config.plans)
    || typeof config.timezone !== 'string' || !config.timezone) return false;
  if (!config.acceptingApplications) return config.period === null && config.plans.length === 0;
  if (!config.period || typeof config.period !== 'object') return false;
  const period = config.period as Record<string, unknown>;
  return typeof period.id === 'string' && period.id.length > 0 && Number.isInteger(period.year)
    && period.status === 'open' && typeof period.startsAt === 'string' && typeof period.endsAt === 'string';
}

function heartbeatUrl(value: string | undefined): URL | null {
  if (!value) return null;
  try {
    const url = new URL(value);
    // A check-specific UUID URL grants no access to other checks or subscriber records.
    if (url.protocol !== 'https:' || url.hostname !== 'hc-ping.com' || url.port || url.username || url.password
      || url.search || url.hash || !/^\/[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i.test(url.pathname)) return null;
    return url;
  } catch { return null; }
}

export async function probeDatabase(env: MonitorEnvironment, overrides: Partial<Dependencies> = {}): Promise<ProbeResult> {
  const dependencies = { ...defaults, ...overrides };
  const started = dependencies.now();
  if (!publicKeyValid(env.SUPABASE_PUBLISHABLE_KEY)) return { ok: false, attempts: 0, durationMs: 0, reason: 'configuration' };
  let result: ProbeResult = { ok: false, attempts: 0, durationMs: 0 };
  for (let attempt = 1; attempt <= 3; attempt++) {
    try {
      const response = await dependencies.fetch(`${SUPABASE_URL}/rest/v1/rpc/get_public_join_config`, {
        method: 'POST',
        headers: { apikey: env.SUPABASE_PUBLISHABLE_KEY, 'Content-Type': 'application/json' },
        body: '{}', redirect: 'error', cache: 'no-store', signal: AbortSignal.timeout(10_000),
      });
      if (!response.ok) {
        await response.body?.cancel();
        result = { ok: false, attempts: attempt, durationMs: dependencies.now() - started, reason: 'http_error', httpStatus: response.status };
        if (response.status !== 429 && response.status < 500) return result;
      } else {
        let valid = false;
        try { valid = joinConfigValid(await response.json()); } catch { /* Never log response bodies. */ }
        if (valid) return { ok: true, attempts: attempt, durationMs: dependencies.now() - started, httpStatus: response.status };
        result = { ok: false, attempts: attempt, durationMs: dependencies.now() - started, reason: 'invalid_response', httpStatus: response.status };
      }
    } catch {
      result = { ok: false, attempts: attempt, durationMs: dependencies.now() - started, reason: 'network_or_timeout' };
    }
    if (attempt < 3) await dependencies.sleep(attempt * 1_000);
  }
  return result;
}

export async function runMonitor(env: MonitorEnvironment, overrides: Partial<Dependencies> = {}): Promise<MonitorResult> {
  const dependencies = { ...defaults, ...overrides };
  const probe = await probeDatabase(env, dependencies);
  const url = heartbeatUrl(env.HEALTHCHECKS_PING_URL);
  if (!url) return { ok: false, probe, heartbeat: env.HEALTHCHECKS_PING_URL ? 'failed' : 'not_configured' };
  // A successful database check is the only path that resets the missed-success timer.
  if (!probe.ok) url.pathname += '/fail';
  for (let attempt = 1; attempt <= 3; attempt++) {
    try {
      const response = await dependencies.fetch(url, {
        method: 'POST', redirect: 'error', cache: 'no-store', signal: AbortSignal.timeout(5_000),
        headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ ok: probe.ok, reason: probe.reason, attempts: probe.attempts, durationMs: probe.durationMs }),
      });
      // Healthchecks can return 200 with "not found" or "rate limited" in the body.
      if (response.ok && (await response.text()).trim() === 'OK') return { ok: probe.ok, probe, heartbeat: 'delivered' };
      await response.body?.cancel();
    } catch { /* Log only the sanitized result returned below. */ }
    if (attempt < 3) await dependencies.sleep(attempt * 1_000);
  }
  return { ok: false, probe, heartbeat: 'failed' };
}
