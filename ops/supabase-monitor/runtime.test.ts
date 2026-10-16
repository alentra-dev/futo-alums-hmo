// @vitest-environment node
import { readFileSync } from 'node:fs';
import { Miniflare, convertV4MiniflareOptions } from 'miniflare';
import ts from 'typescript';
import { expect, it } from 'vitest';

it('runs both requests with options accepted by the Workers runtime', async () => {
  const source = readFileSync(new URL('./check.ts', import.meta.url), 'utf8').replace(/^export /gm, '');
  const script = ts.transpileModule(source, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext } }).outputText;
  const runtime = new Miniflare(convertV4MiniflareOptions({
    modules: true, compatibilityDate: '2026-10-16',
    script: `${script}
      export default { async fetch() {
        const requests = [];
        const result = await runMonitor({
          SUPABASE_PUBLISHABLE_KEY: 'sb_publishable_synthetic_only',
          HEALTHCHECKS_PING_URL: 'https://hc-ping.com/00000000-0000-0000-0000-000000000001'
        }, { fetch: async (url, init) => {
          // Validate in workerd, rather than Node's more permissive Fetch API.
          const request = new Request(url, init);
          requests.push({method: request.method, redirect: request.redirect});
          return new Response(requests.length === 1
            ? JSON.stringify({timezone:'Africa/Lagos', acceptingApplications:false, period:null, plans:[]})
            : 'OK');
        }, sleep: async () => {} });
        return Response.json({result, requests});
      }};
    `,
  }));
  try {
    const response = await runtime.dispatchFetch('http://localhost/');
    expect(await response.json()).toMatchObject({
      result: { ok: true, probe: { ok: true, attempts: 1 }, heartbeat: 'delivered' },
      requests: [{ method: 'POST', redirect: 'manual' }, { method: 'POST', redirect: 'manual' }],
    });
  } finally { await runtime.dispose(); }
}, 20_000);
