# Instructions for coding agents

Before making changes, read `PROJECT_CONTEXT.md` in full. It is the durable project handoff and the source of truth for architecture, business rules, security boundaries, deployment, operations, and current implementation state.

After every meaningful code, schema, workflow, configuration, or operational change:

1. Update `PROJECT_CONTEXT.md` in the same change.
2. Record what changed, why, any migration or deployment step, tests run, and any remaining operational action.
3. Keep historical notes concise but do not remove still-relevant constraints or decisions.
4. Use exact dates for time-sensitive state.

This is a public repository. Never commit subscriber names, emails, dates of birth, phone numbers, addresses, hospital selections, payment evidence, bank account details, Supabase service-role/secret keys, SMTP credentials, access tokens, database passwords, or private exports. Keep one-time operational scripts and outputs containing real data under ignored `.private/` paths. Public fixtures must be synthetic.

Preserve these engineering rules:

- Supabase and PostgreSQL row-level security are the authorization boundary; UI filtering is not security.
- Store money as integer kobo and round each configured fee to the nearest kobo.
- Keep HMO premium payments and separate program assessments distinguishable in schema, UI, reports, exports, and audit records.
- AVON exports contain only provider-required enrollment fields. Internal financial and administrative fields belong only in administrator exports.
- Closed enrollment years are immutable to subscribers and remain available as read-only history.
- Display dates and daily activity in the program-configured time zone, defaulting to `Africa/Lagos`.
- Database changes are append-only migrations. Do not edit an already-applied migration to change production behavior.
- Run `npm run check` and `npm run test:e2e` before declaring application work complete. Add focused tests for changed business logic.
- Review tracked changes for private data before every commit and push.

If `PROJECT_CONTEXT.md` conflicts with production behavior, verify the code and database state, fix the discrepancy, and update the document immediately.
