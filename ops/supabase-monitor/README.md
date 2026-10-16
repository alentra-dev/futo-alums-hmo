# External Supabase monitor

This scheduled Cloudflare Worker performs a read-only PostgreSQL-backed check through
`get_public_join_config` every six hours. Supabase Free inactivity pausing is based on
activity thresholds, so these checks are best effort, not a platform availability guarantee.

Schedule: `17 1,7,13,19 * * *` UTC, or 02:17, 08:17, 14:17, and 20:17 in Africa/Lagos.
The Worker has no public HTTP endpoint. It needs no service-role key, database password,
subscriber identity, additional database objects, or policy changes.

## Access and alerts

1. In the intended Cloudflare account, create an account-scoped API token with
   **Account → Workers Scripts → Edit**. Restrict it to this account.
2. In Healthchecks.io, create a check with a **23-hour period and 1-hour grace**.
   Configure and verify the project's email integration. This alerts after 24 hours
   without a successful ping. Explicit failed checks can alert immediately.
3. Save the following only in ignored `.private/cloudflare-access.env`:

   ```dotenv
   CLOUDFLARE_ACCOUNT_ID=your_account_id
   CLOUDFLARE_API_TOKEN=your_account_scoped_token
   HEALTHCHECKS_PING_URL=https://hc-ping.com/your_check_uuid
   ```

4. Run `chmod 600 .private/cloudflare-access.env`.
5. The existing `.env.local` supplies `VITE_SUPABASE_ANON_KEY`, which must be a
   `sb_publishable_...` key. Alternatively set `SUPABASE_PUBLISHABLE_KEY` in the
   process environment. The monitor explicitly refuses privileged keys.

The heartbeat URL is a private credential. Do not put it in a `VITE_` variable,
Wrangler's tracked variables, command-line arguments, logs, or an issue.
Only sanitized status, timing, attempts, and error categories leave the probe.

## Validate and deploy

From the repository root:

```bash
npm run monitor:probe
npm run monitor:probe -- --with-heartbeat
npm run check
npm run test:e2e
WRANGLER_SEND_METRICS=false npx wrangler deploy --config ops/supabase-monitor/wrangler.json --dry-run
npm run monitor:deploy
```

`monitor:probe` performs a real production read with no subscriber data in its output.
`--with-heartbeat` also sends the outcome to the configured Healthchecks.io check.
Closed enrollment is healthy: `acceptingApplications: false`, a null period, and no
plans are valid. A malformed HTTP-200 response, authorization error, network timeout,
or exhausted retries is a failure.

Deployment requires both database and heartbeat success. The deploy script binds
the two Worker secrets atomically using Wrangler's `--secrets-file`, deletes its
temporary owner-readable bindings file, and verifies the provider-side cron,
secret binding names, and disabled public/preview URLs. Raw deployment logs and
verification metadata remain under ignored `.private/` paths.

After deployment:

```bash
npm run monitor:deploy -- --verify-only
```

This verifies provider configuration and a fresh end-to-end database/heartbeat
request; it does not prove that Cloudflare's scheduler has invoked the Worker.
Observe a real Cron event in Cloudflare Worker logs and the corresponding success
ping in Healthchecks.io before recording automatic scheduling as verified. Cron
configuration can take up to 15 minutes to propagate. A local scheduled-handler
test is useful but must not be described as an actual hosted Cron run.

The test suite includes a synthetic workerd/Miniflare check of both request
configurations. Workers rejects `redirect: 'error'`; the monitor uses `manual`
and treats redirects as failed responses without forwarding credentials.

Email delivery needs its own verification in Healthchecks.io. Test failure/recovery
with a separate synthetic check or an authorized test notification; never break
production Supabase to test an alert.

## Operation

- Database requests have a 10-second timeout and at most three attempts. Transient
  network errors, rate limits, server errors, and invalid responses are retried.
  Permanent HTTP failures stop immediately.
- Only a healthy database result sends a success heartbeat. Failed checks send to
  `/fail`, and heartbeat delivery itself has bounded retries. Healthchecks responses
  such as `OK (not found)` or `OK (rate limited)` do not count as delivery.
- Cloudflare invocation failures are visible even when heartbeat delivery fails.
  Independent missed-success monitoring also detects a disabled/broken scheduler.
- GitHub is used to store and test this code, not as the recurring scheduler. Public
  repository cron inactivity does not stop the Cloudflare schedule.
- To disable checking intentionally, set `triggers.crons` to `[]`, deploy the Worker
  deliberately, and pause its Healthchecks.io check to avoid a missed-run alarm.
- If Supabase is already paused, resume it from the Supabase dashboard. These
  public application requests do not attempt to unpause the project.

References:
[Supabase pausing](https://supabase.com/docs/guides/platform/free-project-pausing),
[Cloudflare Cron](https://developers.cloudflare.com/workers/configuration/cron-triggers/),
[Healthchecks ping API](https://healthchecks.io/docs/http_api/).
