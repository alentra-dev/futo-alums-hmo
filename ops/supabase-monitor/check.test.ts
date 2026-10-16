import { afterEach, describe, expect, it, vi } from 'vitest';
import { probeDatabase, runMonitor, SCHEDULE, SUPABASE_URL, type MonitorEnvironment } from './check';
import worker from './worker';
import config from './wrangler.json';

const env: MonitorEnvironment = {
  SUPABASE_PUBLISHABLE_KEY: 'sb_publishable_synthetic_only',
  HEALTHCHECKS_PING_URL: 'https://hc-ping.com/00000000-0000-0000-0000-000000000001',
};
const closed = { timezone: 'Africa/Lagos', acceptingApplications: false, period: null, plans: [] };
const open = { timezone: 'Africa/Lagos', acceptingApplications: true, period: { id: 'synthetic-period', year: 2026, status: 'open', startsAt: '2026-06-01', endsAt: '2026-10-31' }, plans: [] };
const json = (value: unknown) => new Response(JSON.stringify(value), { headers: { 'Content-Type': 'application/json' } });
const sleep = vi.fn(async () => {});
afterEach(() => { vi.restoreAllMocks(); sleep.mockClear(); });

describe('external Supabase database check', () => {
  it.each([closed, open])('accepts healthy open and closed enrollment responses', async payload => {
    const fetch = vi.fn<typeof globalThis.fetch>().mockResolvedValueOnce(json(payload));
    expect(await probeDatabase(env, { fetch, sleep })).toMatchObject({ ok: true, attempts: 1, httpStatus: 200 });
    expect(fetch).toHaveBeenCalledWith(`${SUPABASE_URL}/rest/v1/rpc/get_public_join_config`, expect.objectContaining({
      method: 'POST', body: '{}', cache: 'no-store', redirect: 'error',
      headers: { apikey: env.SUPABASE_PUBLISHABLE_KEY, 'Content-Type': 'application/json' },
      signal: expect.any(AbortSignal),
    }));
  });

  it.each(['', 'sb_secret_do_not_use', 'eyJhbGciOi.synthetic.service_role'])('refuses missing or privileged keys', async key => {
    const fetch = vi.fn<typeof globalThis.fetch>();
    expect(await probeDatabase({ ...env, SUPABASE_PUBLISHABLE_KEY: key }, { fetch, sleep })).toMatchObject({ ok: false, attempts: 0, reason: 'configuration' });
    expect(fetch).not.toHaveBeenCalled();
  });

  it('recovers from a transient database failure with a bounded retry', async () => {
    const fetch = vi.fn<typeof globalThis.fetch>().mockResolvedValueOnce(new Response('private diagnostic', { status: 503 })).mockResolvedValueOnce(json(closed));
    expect(await probeDatabase(env, { fetch, sleep })).toMatchObject({ ok: true, attempts: 2 });
    expect(sleep).toHaveBeenCalledWith(1000);
  });

  it.each([401,403,404])('fails promptly on a permanent HTTP %s', async status => {
    const fetch = vi.fn<typeof globalThis.fetch>().mockResolvedValue(new Response('private diagnostic', { status }));
    expect(await probeDatabase(env, { fetch, sleep })).toMatchObject({ ok: false, attempts: 1, reason: 'http_error', httpStatus: status });
    expect(fetch).toHaveBeenCalledTimes(1);
  });

  it.each([429,500,503])('retries HTTP %s at most three times', async status => {
    const fetch = vi.fn<typeof globalThis.fetch>().mockImplementation(async () => new Response('diagnostic', { status }));
    expect(await probeDatabase(env, { fetch, sleep })).toMatchObject({ ok: false, attempts: 3, reason: 'http_error', httpStatus: status });
    expect(fetch).toHaveBeenCalledTimes(3);
    expect(sleep.mock.calls).toEqual([[1000],[2000]]);
  });

  it('sanitizes thrown network errors and enforces a request timeout', async () => {
    const fetch = vi.fn<typeof globalThis.fetch>().mockRejectedValue(new Error('sensitive upstream URL or token'));
    const result = await probeDatabase(env, { fetch, sleep });
    expect(result).toMatchObject({ ok: false, attempts: 3, reason: 'network_or_timeout' });
    expect(JSON.stringify(result)).not.toContain('sensitive');
    expect(fetch.mock.calls.every(([,init]) => init?.signal instanceof AbortSignal)).toBe(true);
  });

  it.each([{}, { ...closed, acceptingApplications: 'false' }, { ...closed, plans: null }, { ...closed, period: {} }, { ...open, period: null }])('rejects a misleading HTTP-200 payload', async payload => {
    const fetch = vi.fn<typeof globalThis.fetch>().mockImplementation(async () => json(payload));
    expect(await probeDatabase(env, { fetch, sleep })).toMatchObject({ ok: false, attempts: 3, reason: 'invalid_response' });
  });

  it('rejects HTML masquerading as a successful database response', async () => {
    const fetch = vi.fn<typeof globalThis.fetch>().mockImplementation(async () => new Response('<html>offline</html>'));
    expect(await probeDatabase(env, { fetch, sleep })).toMatchObject({ ok: false, reason: 'invalid_response' });
  });
});

describe('independent heartbeat and scheduled handler', () => {
  it('reports success only after a valid database response', async () => {
    const fetch = vi.fn<typeof globalThis.fetch>().mockResolvedValueOnce(json(closed)).mockResolvedValueOnce(new Response('OK'));
    expect(await runMonitor(env, { fetch, sleep })).toMatchObject({ ok: true, probe: { ok: true }, heartbeat: 'delivered' });
    expect(String(fetch.mock.calls[1][0])).toBe(env.HEALTHCHECKS_PING_URL);
    const metadata = String(fetch.mock.calls[1][1]?.body);
    expect(metadata).not.toContain(env.SUPABASE_PUBLISHABLE_KEY);
    expect(metadata).not.toContain('plans');
  });

  it('signals failure without sending a success heartbeat', async () => {
    const fetch = vi.fn<typeof globalThis.fetch>().mockResolvedValueOnce(new Response('diagnostic', { status: 401 })).mockResolvedValueOnce(new Response('OK'));
    expect(await runMonitor(env, { fetch, sleep })).toMatchObject({ ok: false, probe: { ok: false }, heartbeat: 'delivered' });
    expect(String(fetch.mock.calls[1][0])).toBe(`${env.HEALTHCHECKS_PING_URL}/fail`);
    expect(fetch.mock.calls.filter(([url]) => String(url) === env.HEALTHCHECKS_PING_URL)).toHaveLength(0);
  });

  it.each([undefined, 'https://example.com/private-key', `${env.HEALTHCHECKS_PING_URL}?secret=anything`])('does not claim monitoring is configured with an absent or invalid heartbeat URL', async url => {
    const fetch = vi.fn<typeof globalThis.fetch>().mockResolvedValueOnce(json(closed));
    expect(await runMonitor({ ...env, HEALTHCHECKS_PING_URL: url }, { fetch, sleep })).toMatchObject({ ok: false, probe: { ok: true }, heartbeat: url ? 'failed' : 'not_configured' });
    expect(fetch).toHaveBeenCalledTimes(1);
  });

  it.each(['OK (not found)', 'OK (rate limited)', 'not found'])('rejects a heartbeat HTTP-200 body of %s', async body => {
    const fetch = vi.fn<typeof globalThis.fetch>().mockResolvedValueOnce(json(closed)).mockImplementation(async () => new Response(body));
    expect(await runMonitor(env, { fetch, sleep })).toMatchObject({ ok: false, probe: { ok: true }, heartbeat: 'failed' });
    expect(fetch).toHaveBeenCalledTimes(4);
  });

  it('recovers from temporary heartbeat delivery failure without repeating the database check', async () => {
    const fetch = vi.fn<typeof globalThis.fetch>().mockResolvedValueOnce(json(closed)).mockRejectedValueOnce(new Error('private heartbeat URL')).mockResolvedValueOnce(new Response('OK'));
    expect(await runMonitor(env, { fetch, sleep })).toMatchObject({ ok: true, heartbeat: 'delivered' });
    expect(fetch.mock.calls.filter(([url]) => String(url).startsWith(SUPABASE_URL))).toHaveLength(1);
  });

  it('uses the same check in the scheduled handler and emits sanitized logs', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValueOnce(json(closed)).mockResolvedValueOnce(new Response('OK')));
    const log = vi.spyOn(console, 'log').mockImplementation(() => {});
    try {
      await worker.scheduled({ cron: SCHEDULE, scheduledTime: Date.parse('2026-10-16T13:17:00Z') }, env);
      const logged = JSON.parse(log.mock.calls[0][0]);
      expect(logged).toMatchObject({ event: 'supabase_database_check', scheduledAt: '2026-10-16T13:17:00.000Z', ok: true });
      expect(JSON.stringify(logged)).not.toContain(env.HEALTHCHECKS_PING_URL);
      expect(JSON.stringify(logged)).not.toContain(env.SUPABASE_PUBLISHABLE_KEY);
    } finally { vi.unstubAllGlobals(); }
  });

  it('has four daily UTC triggers and no public HTTP trigger', () => {
    expect(config.triggers.crons).toEqual([SCHEDULE]);
    expect(SCHEDULE).toBe('17 1,7,13,19 * * *');
    expect(config.workers_dev).toBe(false);
    expect(config.preview_urls).toBe(false);
    expect(worker).not.toHaveProperty('fetch');
  });
});
