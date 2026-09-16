# FUTO Alums HMO Program: Durable Project Context

Last updated: 2026-09-15

This document is the persistent handoff for engineers and LLM coding agents working on this repository. Read it before changing the application and update it whenever code, schema, business rules, deployment, configuration, or production operating state changes. `AGENTS.md` makes that maintenance requirement explicit.

## 1. Product mission

The FUTO Alums HMO Program is a mobile-first group healthcare enrollment and administration system for a Nigerian alumni program. It replaces the manual spreadsheet-and-message process used for the 2025 enrollment year. The first live portal enrollment is 2026, while 2025 is retained as imported history.

The application supports:

- existing-subscriber renewal using preloaded historical details;
- new-subscriber applications and lightweight administrator approval;
- one login account managing one or more principal-member households;
- individual and family plan enrollment;
- principal and dependent demographic capture;
- payment-confirmation uploads for full or partial payments, without an arbitrary count limit;
- administrator payment review and manual uploads on a subscriber's behalf;
- exact underpayment and overpayment tracking;
- AVON-compatible and internal Excel exports by enrollment year;
- configurable enrollment periods, plan offerings, fees, payment accounts, and time zone;
- separate configurable program assessments, adjustments, payments, and future-year credits;
- subscriber-isolated history and administrator-wide reporting;
- audit history and daily unique sign-in activity.

The design anticipates more alumni cohorts and potentially multiple HMO providers, but the current provider is AVON and multi-provider support is not an immediate requirement.

## 2. Repository and deployed services

- Repository: `alentra-dev/futo-alums-hmo` on GitHub.
- Branch: `main`.
- Frontend: React 19, TypeScript, Vite, React Router.
- Backend: Supabase Auth, PostgreSQL, Row Level Security, Storage, RPC functions, and Edge Functions.
- Hosting: GitHub Pages at `https://alentra-dev.github.io/futo-alums-hmo/`.
- Production Supabase project reference: `dkfilwifdkyifsyzomox`.
- Production Supabase URL: `https://dkfilwifdkyifsyzomox.supabase.co`.
- Email delivery: Resend through a verified program subdomain; credentials are Supabase secrets and must not be committed.
- Currency: Nigerian naira; all persisted calculations use integer kobo.
- Default program time zone: `Africa/Lagos`, configurable by administrators.
- Record-retention policy: seven years.

The GitHub repository is public. The application code may be public; all real personal, family, contact, health-adjacent enrollment, payment, and credential data must remain private in Supabase or ignored local files.

## 3. Important files and modules

- `src/App.tsx`: route definitions and access boundaries.
- `src/context/AppContext.tsx`: application state, Supabase RPC orchestration, demo-mode behavior, and mutations.
- `src/lib/types.ts`: shared domain types and snapshot contracts.
- `src/lib/money.ts`: integer-kobo calculations, fee rounding, and payment-position helpers.
- `src/lib/financialPosition.ts`: HMO premium versus program-assessment allocation and balance calculations.
- `src/lib/export.ts`: summary, full administrator, and AVON workbook generation.
- `src/lib/enrollmentAccess.ts`: account-to-household selection and subscriber isolation helpers.
- `src/lib/subscriberWorkflow.ts`: enrollment editability and family limits.
- `src/lib/personValidation.ts` and `src/lib/personDetails.ts`: required/optional fields and dependent residence behavior.
- `src/pages/JoinPage.tsx`: progressive new-subscriber application.
- `src/pages/EnrollmentPage.tsx`: principal/dependent review and submission.
- `src/pages/PaymentsPage.tsx`: HMO and program-assessment balances, accounts, uploads, and history.
- `src/pages/admin/`: administrator dashboards and operating tools.
- `supabase/migrations/`: append-only production schema and RPC migrations.
- `supabase/functions/`: privileged email and subscriber-access operations.
- `scripts/import-2025.ts`: private historical import workflow.
- `docs/ADMIN_CHEATSHEET.md`: administrator-facing operating guide.
- `tests/e2e/workflows.e2e.ts`: mobile and desktop critical-path Playwright suite.
- `.private/`: ignored local operational scripts and data. Never force-add this directory.

## 4. Authentication and account model

Authentication uses email magic links through Supabase Auth. A login link is single-use in practice and can expire according to Supabase Auth configuration. The frontend consumes and clears callback credentials so revisiting an old link does not corrupt a newer session.

Do not assume one email equals one principal member. An authenticated account is linked to households, and one account can manage multiple principal-member records. The currently selected household/enrollment is held by the application context.

Roles:

- `subscriber`: can access only linked households and their own enrollment/payment/history records;
- `admin`: program-wide administration;
- `owner`: administrator privileges plus owner-level access management;
- admin-only/owner-only accounts may have no subscriber household.

The UI distinguishes subscriber accounts from administrator-only accounts. Access-email changes are performed through a privileged Edge Function so the Auth identity and application linkage stay synchronized without rewriting historical enrollment email fields.

Authorization must be enforced in PostgreSQL/RPC/storage policies. Never rely only on route guards or filtered frontend arrays.

## 5. Enrollment lifecycle

An enrollment period is year-specific and normally runs from June 1 through August 31, but administrators can extend it or close it early. The admin enrollee list defaults to the currently open period, or the most recently closed period when none is open. Reports and exports always use the selected period.

Subscriber lifecycle:

1. Existing subscribers request or use a magic link sent to the account access email.
2. New subscribers start at the public home/join experience and enter progressive application details.
3. Administrators review duplicate indicators and approve or reject new applications.
4. Approved subscribers receive notification and access their portal.
5. Subscribers compare current plan offerings, select individual or family coverage, review people one at a time, optionally enter a hospital, consent, and submit.
6. Subscribers upload evidence after each transfer. Multiple partial payments are supported.
7. Administrators verify or reject each payment and can upload evidence for a subscriber when required.
8. Administrators close the period. Subscriber enrollment data becomes read-only.
9. Administrators generate the selected year's provider and internal reports.

New-application duplicate review flags likely matches using email, phone, and date of birth. This is an administrator aid, not automatic rejection. The alumni WhatsApp group provides a practical human verification path.

Family coverage is limited by current AVON rules to principal, spouse, and up to four eligible children, for a maximum of five dependents. Dependents can be added and removed while the enrollment period is editable. Historical years are not changed when a dependent is removed from a current draft.

## 6. Person-field rules

Required principal/enrollee fields follow the provider submission requirements and application validation. Middle name is optional; never require the user to type `N/A`. Preferred hospital is optional and uses searchable free text because a complete AVON provider directory is not available. Other fields made optional should stay consistent across the new-subscriber form, renewal form, validation helpers, database RPCs, and exports.

The authoritative provider fields came from the supplied AVON completed-template worksheet. Public repository fixtures must never reproduce real rows from that workbook.

## 7. Financial model

### 7.1 HMO premium

For the finalized 2026 enrollment, the subscriber total is:

`base premium + rounded 1% AVON NHIS fee + rounded 2% program administrative fee`

Each fee is calculated from the base premium and independently rounded to the nearest kobo. The previously considered 15% banking transaction tax was removed. The previously considered 15% percentage-based program administration fee was also rejected for the finalized 2026 model. Do not restore either without an explicit new decision and migration.

Subscribers should see one total payable while receiving clear disclosure of the configured fee components. Premiums and fee amounts are snapshotted on each enrollment so later rate changes do not rewrite historical years unintentionally.

Verified HMO payments are compared with `subscriber_total_kobo` to produce:

- `unpaid`: no verified premium payment;
- `underpaid`: verified total below payable total;
- `paid`: exact match;
- `overpaid`: verified total above payable total.

Never clamp the reported balance to zero without separately reporting the overpayment. Pending payments do not count as verified funds.

### 7.2 Program assessments

Program assessments are separate from HMO premiums. They have their own:

- name and description;
- base amount;
- retained fee portion;
- future-enrollment credit portion and credit year;
- due date;
- active state;
- payment account and transfer-reference prefix;
- per-enrollment inclusion, signed adjustment, and note;
- payment records linked through `payments.assessment_id`.

The first configured assessment supports CAC/entity-registration costs. Its 2026 business design is a flat base contribution, divided into a one-time program enrollment fee and a credit toward the next annual HMO enrollment. Exact production values and banking details are private operational configuration, not source code.

The net assessment due for an enrollee is:

`assessment base + HMO underpayment - HMO overpayment + admin adjustment - verified assessment payments`

The result is floored at zero for collection, while the underlying premium position remains visible. Future credit is a planned amount and should be described to subscribers as becoming available when the assessment is settled. A future enhancement may require a true credit ledger when the next enrollment year opens.

HMO and assessment evidence use distinct, labeled upload actions. Both permit multiple confirmations. The administrator payment-review screen and exports identify the purpose.

## 8. 2026 operational state

As of 2026-09-15:

- enrollment has concluded and the 2026 period is intended to be closed;
- six final subscriber enrollments require reconciled plan selections and verified premium totals;
- exact underpayments and overpayments must remain visible and feed the separate assessment due calculation;
- one apparent new-subscriber payment was resolved to an existing subscriber account;
- a spouse captured in an accidental new-application draft must be attached as a dependent to that existing household;
- one non-renewing 2025 household's hospital preference must seed the correct 2026 enrollee;
- the current financial-assessment migration must be deployed before the private reconciliation is applied.

The production reconciliation is intentionally stored only in ignored `.private/reconcile-2026.ts` because it contains real subscriber mappings and financial details. Run without `--apply` first; it validates all identities and prints a preview. Run with `--apply` only after the schema migration is confirmed in production. Do not move its contents into tracked code, documentation, tests, issues, or commit messages.

After production application, update this section with the exact date, migration status, reconciliation success, period status, and verification counts, but continue to omit identities and private account data.

## 9. Reporting and exports

All enrollee screens, reports, and exports are scoped to the administrator-selected enrollment year.

Exports:

- `Summary`: principal member only, selected plan/category, total owed, verified HMO paid, exact premium position, assessment paid/due, and future credit as applicable.
- `Admin full export`: all provider enrollment fields plus internal financial and administrative fields.
- `AVON export`: provider-required enrollment rows only. It must exclude internal payment, program fee/accounting, assessment, audit, and `FUTO HMO FULL PAYMNT` fields.

Do not include dependent names in the high-level program summary. Dependents appear only where required for full administration/provider submission.

## 10. Privacy, storage, and audit

Privacy contact and real operational contact data are configured outside public documentation. The privacy notice covers processing and sharing with AVON/necessary service providers, authority to submit family-member information, notice to adult dependents, and seven-year retention.

Payment evidence is stored in a private Supabase Storage bucket. Signed URLs are generated only for authorized users. Administrators can view evidence in payment review.

Audit requirements:

- record enrollment, people, plan, period, payment, account, role, fee, assessment, and other sensitive changes;
- show the affected subscriber/person or meaningful object, not only a generic action;
- show the specific administrator email or display name when an authenticated administrator acted;
- label service/import/reconciliation changes as system actions when no user actor exists;
- render timestamps in the program-configured time zone.

Daily unique sign-in activity uses the configured program time zone for day boundaries. The admin activity view distinguishes subscriber-linked accounts from admin/owner-only accounts.

## 11. Database migration history

Migrations are timestamped and append-only. Apply them in filename order even if a filesystem listing is unordered.

Major stages:

- `202608160001` through `202608160004`: initial schema, portal RPCs, history/rollover, owner/proof functions.
- `202608200005`: subscriber workspace isolation.
- `202608200006` and `007`: year-aware admin reporting and 2025 payment backfill.
- `202608200008`: new-subscriber applications and duplicate review.
- `202608210009` and `010`: year-safe people updates, timezone handling, and expanded audit coverage.
- `202608220011`: email campaign delivery tracking.
- `202608250012`: negotiated 2026 rates and Vital-plan history handling.
- `202608260013` through `016`: sign-in activity, temporary tax support, adjustable surcharge rates, and admin subscriber-access management.
- `202608260017`: removal of the transaction tax and restoration of the then-current program fee model.
- `202608280018`: optional person fields.
- `202609120019`: separate financial assessments, enrollment adjustments, assessment-linked payments, workspace/admin/submission RPCs, audit triggers, and finalized 2026 1% + 2% premium fees.

When adding a migration, document its purpose here and state whether it has been deployed to production.

## 12. Supabase security model

Key principles:

- all user-facing database access occurs through authenticated sessions and scoped tables/RPCs;
- SECURITY DEFINER functions set `search_path=''` and explicitly schema-qualify references;
- functions revoke public/anonymous execution and grant only the required role;
- subscriber results are constrained with household-access checks;
- administrator mutations verify program-admin membership;
- private storage paths are enrollment-scoped and validated server-side;
- Edge Functions holding service-role capabilities authenticate and authorize the caller or use narrowly guarded, rotated batch keys;
- publishable/anon keys may be present in built frontend configuration; secret/service-role keys must never use a `VITE_` prefix.

Any new RPC or policy requires a deliberate cross-household access review. Test with at least two unrelated subscriber identities when production-like security testing is available.

## 13. Local development and tests

Setup:

```bash
npm install
cp .env.example .env.local
npm run dev
```

Use `VITE_DEMO_MODE=true` for synthetic local records. Never point destructive tests at production.

Required validation:

```bash
npm run check
npm run test:e2e
```

`npm run check` runs ESLint, Vitest, TypeScript, and the production Vite build. The Playwright suite runs critical workflows in desktop Chromium and a mobile Chromium viewport. It also checks horizontal overflow and clipped controls on important screens.

Current baseline as of this document update:

- 13 Vitest files, 41 unit tests passing;
- 10 Playwright scenarios passing: five workflows at desktop and mobile sizes;
- production build passing;
- Vite reports large chunks for the chart/core/Excel bundles; this is a performance warning, not a failed build.

Important regression coverage includes fee rounding, payment positions, exports, duplicate matching, person validation, enrollment isolation helpers, magic-link callback behavior, new applications, payment uploads, admin review, admin tools, and closed-period subscriber behavior.

## 14. Deployment and operations

### Frontend

`.github/workflows/deploy-pages.yml` runs on pushes to `main`. It installs dependencies, lints, runs unit tests, builds with production Supabase repository variables, and deploys `dist/` to GitHub Pages.

Required repository variables:

- `VITE_SUPABASE_URL`
- `VITE_SUPABASE_ANON_KEY`
- `SUPABASE_PROJECT_ID`

### Database and Edge Functions

`.github/workflows/deploy-supabase.yml` is manually dispatched. It:

1. links the configured Supabase project;
2. previews all pending migrations;
3. applies migrations;
4. pushes Auth configuration;
5. deploys privileged Edge Functions.

Required repository secrets:

- `SUPABASE_ACCESS_TOKEN`
- `SUPABASE_DB_PASSWORD`

Supabase secrets such as email-provider credentials are configured in Supabase, not GitHub Pages build variables.

### Renewal campaign

`.github/workflows/send-2026-renewal-email.yml` supports `dry_run` and guarded `send` modes. It uses an ephemeral invocation key, tracks idempotent deliveries, and rotates the key afterward. Do not rerun a historical campaign casually. Validate recipients first and ensure recipient-to-household links are correct before any send.

### Typical release sequence

1. Inspect `git status` and `git diff` without reverting unrelated user changes.
2. Run private-data scans on tracked/untracked candidates.
3. Run `npm run check` and `npm run test:e2e`.
4. Commit code and migration together with this document updated.
5. Push `main`; monitor the Pages workflow.
6. Manually dispatch the Supabase workflow when a migration or Edge Function changed; monitor every step.
7. Run any private production reconciliation in preview mode, then `--apply` only after migration verification.
8. Re-query production totals, access isolation, period status, and audit records.
9. Update this document with deployed state and verification results.

## 15. Administrator capabilities

Administrators can:

- review/approve/reject new applications and duplicate indicators;
- select an enrollment year and inspect enrollee records;
- see plan category, premium totals, verified totals, under/overpayment, assessment status, and future credit;
- generate summary, full internal, and AVON workbooks;
- review evidence, verify/reject payments, and upload evidence on behalf of a subscriber;
- configure the program time zone;
- configure NHIS and program fee rates with recalculation controls;
- configure enrollment periods and plan offerings;
- configure the HMO payment account;
- configure a period assessment and its dedicated account;
- include/exclude an enrollee from an assessment and enter a signed adjustment/note;
- change a subscriber's access email through the protected workflow;
- manage administrator roles subject to owner controls;
- inspect audit history and daily unique sign-in activity.

Keep `docs/ADMIN_CHEATSHEET.md` aligned whenever an administrator workflow or label changes.

## 16. Known follow-ups and design cautions

- A future-year credit currently derives from the assessment configuration. Before 2027 enrollment opens, implement or confirm a durable credit-ledger/application mechanism so settled credits are applied exactly once.
- The assessment model currently supports the active operational need. If multiple simultaneous assessments become common, replace any UI assumptions that select the first matching assessment with explicit selection and aggregation.
- Production reconciliation uses a system actor unless explicitly run through an authenticated admin operation. Audit display should make that distinction clear.
- Continue mobile-first testing. Most users access the portal by phone, and payment upload discoverability is a critical support burden.
- Continue provider-template regression tests whenever AVON changes its workbook fields or plan definitions.
- Consider further bundle splitting for ExcelJS and charting if mobile load performance becomes a problem.
- Before a new annual rollover, verify dates, offerings, rates, payment account, assessment status, hospital guidance, email copy, redirect URLs, SMTP, and exports in a non-production or dry-run path.

## 17. Change log for this handoff

### 2026-09-15

- Added a separate configurable financial-assessment model rather than folding CAC/entity-registration costs into HMO premium fees.
- Finalized 2026 HMO surcharge defaults at 1% AVON NHIS plus 2% program administration and removed any 15% transaction-tax/percentage-administration behavior from current calculations.
- Added exact HMO underpayment/overpayment reporting and assessment-offset calculations.
- Added assessment management and per-enrollee adjustment controls for administrators.
- Added distinct HMO and assessment payment uploads, including explicit mobile access to both.
- Expanded internal exports while keeping AVON exports free of internal accounting fields.
- Added unit and end-to-end regression coverage for the new financial behavior.
- Prepared an ignored private reconciliation with dry-run validation; production application remains dependent on deployment of migration `202609120019` at the time of writing.
- Created this durable handoff and the maintenance rules in `AGENTS.md`.
