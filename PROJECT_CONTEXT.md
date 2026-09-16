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
- `src/lib/paymentInstruction.ts`: composes the single program account with the transfer reference for each payment purpose.
- `src/lib/export.ts`: summary, full administrator, and AVON workbook generation.
- `src/lib/enrollmentAccess.ts`: account-to-household selection, subscriber isolation helpers, and `workspaceEnrollment` for administrators acting for a subscriber.
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

### 4.1 Administrators acting for a subscriber

Some alumni never reach the portal and send their details to an administrator instead. An administrator opens a subscriber's workspace from **Enrollees → Act for** and completes any subscriber task for them: plan selection, household details, submission, and payment uploads.

This is not impersonation of the subscriber's identity. The administrator stays signed in as themselves:

- database access already permitted it — `can_access_household` admits program administrators for every household in the program, and administrators additionally bypass the closed-period check in `update_enrollment_details` and `select_enrollment_plan`;
- `audit_row_change` records `auth.uid()`, so every change is attributed to the acting administrator and never to the subscriber who never signed in;
- the frontend guard in `workspaceEnrollment` is convenience only. PostgreSQL remains the authorization boundary: a subscriber who forced an acting id would still be refused by `can_access_household`.

Acting state is deliberately held in memory only. It does not survive a reload, a new tab, or sign-out, and a sticky banner naming the subscriber and the acting administrator's email is shown at all times with a one-click exit.

**Consent is never given by an administrator.** An acting administrator does not see the subscriber's consent checkbox. They record consent the subscriber already gave elsewhere through `record_offline_consent`, which requires a program administrator, a non-empty description of how consent was received, and a non-future date. `enrollments.consent_channel` separates `portal` from `offline`, with `consent_recorded_by`, `consent_evidence_note`, and `consent_recorded_at` alongside. A `sync_consent_provenance` trigger keeps provenance consistent with `consented_at` no matter which RPC writes it, so clearing consent clears its attribution and a later portal consent supersedes an offline one. Acting administrators pass the stored `consentedAt` through unchanged on submission so recorded provenance survives.

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

This combined figure is a **reconciliation position, not a payment instruction**. The program collects every payment into **one bank account**; HMO premiums and program assessments are distinguished only by the transfer reference the subscriber puts on the transfer, which is what makes the deposits reconcilable. The subscriber interface must therefore never present the combined net as a single amount to transfer, because the resulting payment would be recorded and referenced as an assessment while part of it is premium. `enrollmentFinancialPosition` also returns:

- `assessmentOwnNetKobo` / `assessmentOwnDueKobo`: `assessment base + admin adjustment - verified assessment payments`, which is what the subscriber transfers under the assessment reference;
- `premiumVarianceKobo`: the swept HMO under/overpayment, which is transferred under the HMO premium reference.

`assessmentOwnNetKobo + premiumVarianceKobo === assessmentNetKobo` always holds. Subscriber-facing screens collect `assessmentOwnDueKobo`, disclose the premium variance separately, and show the combined position only as context. Administrator reports and exports continue to use `assessmentNetKobo`.

### 7.3 One account, many references

`src/lib/paymentInstruction.ts` composes every payment instruction shown to a user: bank details always come from the single program `paymentAccount`, and only `referencePrefix` varies by purpose. Use it rather than reading an account off an assessment.

`financial_assessments` still carries its own `beneficiary`, `bank`, and `account_number` columns from migration `202609120019`. They are a second copy of the same account and were separately editable in program settings, so they could drift and hand a subscriber a stale account number. The assessment form now edits only the transfer reference, displays the inherited account read-only, rejects a reference that matches the HMO reference, and writes the program account values back on every save so stored rows converge. Removing those columns needs its own migration.

HMO and assessment evidence use distinct, labeled upload actions. Both permit multiple confirmations. The administrator payment-review screen and exports identify the purpose.

## 8. 2026 operational state

As of 2026-09-15:

- migration `202609120019` was deployed successfully to production;
- the matching GitHub Pages build was deployed successfully;
- the 2026 enrollment period is closed;
- six distinct final enrollments have the approved plans, categories, and verified HMO totals;
- the six reconciliation payments total ₦1,577,991.18 and remain individually reportable as exact, underpaid, or overpaid;
- all six enrollments are assigned to the active program assessment;
- the payment initially thought to represent a new subscriber is linked to the correct existing account;
- the spouse from the accidental draft is linked to the existing family enrollment and the draft is resolved as a confirmed duplicate;
- the required hospital preference was transferred to the renewing enrollee;
- an independent read-only query verified the period, rates, payments, enrollment statuses, assessment assignments, spouse link, duplicate resolution, and hospital transfer after application.

The production reconciliation is intentionally stored only in ignored `.private/reconcile-2026.ts` because it contains real subscriber mappings and financial details. It is retained for audit/recovery context and must never be moved into tracked code, documentation, tests, issues, or commit messages.

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
- `202609150020`: consent provenance columns on `enrollments`, the `sync_consent_provenance` trigger, `record_offline_consent`, and the `get_consent_records` side-car read. Deployed to production 2026-09-16.

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

Demo-mode fixtures in `src/data/demo.ts` derive the preview period from the current date (open from 45 days ago to 45 days ahead) rather than fixed calendar dates. Hardcoded dates silently expired once the real window passed, which turned demo mode into a read-only portal and quietly removed plan selection, enrollment editing, and submission from end-to-end coverage. Keep demo dates relative.

Current baseline as of this document update:

- 13 Vitest files, 45 unit tests passing;
- 16 Playwright scenarios passing: eight workflows at desktop and mobile sizes;
- production build passing;
- Vite reports large chunks for the chart/core/Excel bundles; this is a performance warning, not a failed build.

End-to-end coverage now includes both an open and a closed enrollment period, plan changes and enrollment submission, the family-coverage household rule in the new-subscriber flow, future-dated payment rejection, and the payment-review confirmation prompts.

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
- configure a period assessment and the transfer reference that identifies its payments;
- include/exclude an enrollee from an assessment and enter a signed adjustment/note;
- change a subscriber's access email through the protected workflow;
- manage administrator roles subject to owner controls;
- act in a subscriber's workspace to complete their enrollment tasks when they cannot reach the portal, and record consent received offline;
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
- `.env.local` on a developer machine may hold production Supabase credentials, with `VITE_DEMO_MODE=true` as the only thing preventing `npm run dev` from operating on live data. Prefer a separate non-production project for local work, and confirm demo mode before exercising any mutation locally.
- A follow-up migration should drop `beneficiary`, `bank`, and `account_number` from `financial_assessments` and keep only `reference_prefix`, so the single program account cannot be duplicated in storage at all (§7.3).
- Open decision: whether sweeping the HMO premium variance into the assessment net (§7.2) is the intended long-term accounting treatment. The interface now keeps the two separately payable under distinct references, but the combined figure is still what administrator reports and exports present.
- `relation` is free text for principals and dependents. AVON submissions and the family-composition rule (spouse plus up to four children under 21) would both benefit from a constrained vocabulary; dependent ages and relationships are currently unvalidated.
- `paymentPosition` reports `underpaid`, `paid in full`, and `overpaid`. §7.1 also describes an `unpaid` state for enrollments with no verified payment; it is currently reported as `underpaid`. Splitting it would change exported values, so it needs a deliberate decision.
- Enrollment edits are held in local component state with no unsaved-changes warning; navigating away discards them.
- The administrator application review shows dependent counts but not dependent identities, so a family application is approved without its household being visible.

### 2026-09-15 (administrators acting for subscribers)

Added the ability for an administrator to complete enrollment tasks for alumni who cannot reach the portal and send details manually (§4.1). No read or write permission needed changing: `can_access_household` already admitted administrators and `audit_row_change` already recorded `auth.uid()`, so attribution to the acting administrator was correct by construction. The work added the entry point, a sticky acting banner with a one-click exit, and consent provenance.

Migration `202609150020` adds `consent_channel`, `consent_recorded_by`, `consent_evidence_note`, and `consent_recorded_at` to `enrollments`, the `sync_consent_provenance` trigger, `record_offline_consent`, and `get_consent_records`. Existing consent is backfilled as `portal`.

`loadConsentRecords` degrades to an empty list when the RPC is unavailable. A side-car read for one administrator panel must never be able to blank the portal, including in the window between a frontend deploy and the migration that creates the function.

Deployed 2026-09-16: commit `bcbd45a`, GitHub Pages run `35059123871`, Supabase run `35059126416`. The preview step listed exactly `202609150020` and the apply step reported `Applying migration 202609150020_admin_acting_and_offline_consent.sql` with no other pending migration. Verified afterwards from an unauthenticated client: `get_consent_records` and `record_offline_consent` both return `42501 permission denied for function`, which confirms they exist in production and that anonymous execute is revoked, against a control name that returns `PGRST202` not found.

## 17. Change log for this handoff

### 2026-09-15 (UX, workflow, and reporting review)

A full review of subscriber, new-applicant, administrator, and owner journeys was run against demo mode only. No production read or write occurred; this was verified by inspecting outbound requests across every route plus a payment upload. Fixes applied:

- **Payment references.** The subscriber dashboard and payments screen led with the program assessment whenever one was assigned, presenting the combined reconciliation net (assessment base plus HMO shortfall) as a single amount to transfer under the assessment reference. Because the transfer reference is the only thing distinguishing the two obligations in one shared account, a subscriber following the interface would have sent premium money tagged as an assessment payment, leaving the premium recorded as underpaid and the deposit unreconcilable. Both screens now lead with whichever obligation is outstanding, ask for only `assessmentOwnDueKobo` under the assessment reference, and disclose the premium variance with its own reference. The reconciliation formula in §7.2 is unchanged.
- **Duplicate account storage.** Program settings collected bank details twice — once for HMO premiums and once per assessment — for what is a single program account, so the two copies could drift. The assessment now inherits the program account and configures only its transfer reference (§7.3).
- **Settled assessments** no longer render as `₦0.00 ... due`.
- **Family coverage in the new-subscriber flow** accepted zero dependents, so an applicant could submit family pricing covering one person. `householdValidationMessage` now gates step 3 and submission, matching the renewal flow.
- **Public join page** disclosed a 15% program administrative fee through a stale fallback when no period was loaded. It now uses the configured rates, defaulting to 1% NHIS and 2% program administration.
- **Administrator dashboard** excluded program-assessment payments from the pending-review metric and queue preview, hiding them from the operational overview. Both now cover every pending confirmation and label its purpose.
- **Payment verification and rejection** were single-click and irreversible. Both now confirm with amount, purpose, and subscriber. Administrator role changes confirm as well.
- **Assessment configuration** failed silently on error and accepted a fee portion and future credit that did not sum to the base contribution. Both are now reported in the form.
- **Program settings** showed a hardcoded placeholder list of three administrators; it now links to the real access page instead of implying membership.
- Administrator payment uploads reset to the HMO premium when the selected subscriber has no assessment, which previously left the upload form unrendered.
- Payment dates are limited to today in the program time zone; exports write a blank provider date instead of `undefined/undefined/`; the payment-review date uses the program time zone.
- Assessment labels follow the configured assessment name rather than hardcoded "CAC".
- Modals close on `Escape` and move focus into the dialog; in-app navigation replaced full-page `location.assign` reloads; history and access-page load errors are surfaced instead of being swallowed.

Known follow-ups are recorded in §16.

### 2026-09-15

- Added a separate configurable financial-assessment model rather than folding CAC/entity-registration costs into HMO premium fees.
- Finalized 2026 HMO surcharge defaults at 1% AVON NHIS plus 2% program administration and removed any 15% transaction-tax/percentage-administration behavior from current calculations.
- Added exact HMO underpayment/overpayment reporting and assessment-offset calculations.
- Added assessment management and per-enrollee adjustment controls for administrators.
- Added distinct HMO and assessment payment uploads, including explicit mobile access to both.
- Expanded internal exports while keeping AVON exports free of internal accounting fields.
- Added unit and end-to-end regression coverage for the new financial behavior.
- Deployed migration `202609120019`, applied the ignored private reconciliation, closed the 2026 period, and independently verified all aggregate results in production.
- Created this durable handoff and the maintenance rules in `AGENTS.md`.
