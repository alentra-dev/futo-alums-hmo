# FUTO Alums HMO Program: Durable Project Context

Last updated: 2026-10-22

This document is the persistent handoff for engineers and LLM coding agents working on this repository. Read it before changing the application and update it whenever code, schema, business rules, deployment, configuration, or production operating state changes. `AGENTS.md` makes that maintenance requirement explicit.

## 1. Product mission

The FUTO Alums HMO Program is a mobile-first group healthcare enrollment and administration system for a Nigerian alumni program. It replaces the manual spreadsheet-and-message process used for the 2025 enrollment year. The first live portal enrollment is 2026, while 2025 is retained as imported history.

The application supports:

- existing-subscriber renewal using preloaded historical details;
- new-subscriber applications and lightweight administrator approval, accepted year-round: within the renewal window and, after it, as late enrollments with AVON proration and a next-year credit;
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
- `src/lib/proration.ts`: AVON coverage term, late-enrollment proration, and intake-mode helpers (mirrors migration `202610220023`).
- `src/components/ProrationBreakdown.tsx` and `src/components/LateEnrollmentNotice.tsx`: shared late-enrollment disclosures.
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

### 5.1 Continuous (late) enrollment

The renewal window closes, but AVON accepts new members for the rest of the coverage term, so new-subscriber applications never stop while a term is running. `public.application_intake` picks the period: the open renewal window first; otherwise the latest period that is closed or past its `ends_at`, has `late_enrollment_open`, and whose AVON term has not ended. Existing subscribers' enrollments stay read-only after the window; only new subscribers join late. Administrators can switch late enrollment off per period in **Program settings → Enrollment period**.

Approval after the renewal window records `enrollments.avon_coverage_start` as the approval month in the program time zone (never before the term start). Administrators correct it to match AVON's invoice through **Enrollees → Coverage** (`set_enrollment_coverage_start`, admin-only, reason required, audited). Approval also assigns the active program assessment at its default (new-enrollee) terms, inside or outside the window; this replaces the 2026-10-10 rule that approval did not assign an assessment.

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
- the shared program payment account and an assessment-specific transfer-reference prefix;
- per-enrollment inclusion, signed adjustment, and note;
- per-enrollment snapshots of contribution, retained fee, future credit, and credit year; program amounts are defaults for new assignments, not live overrides of existing terms;
- payment records linked through `payments.assessment_id`.

The first configured assessment supports CAC/entity-registration costs. Its 2026 business design is a flat base contribution, divided into a one-time program enrollment fee and a credit toward the next annual HMO enrollment. Exact production values and banking details are private operational configuration, not source code.

Migration `202610100022` adds individual financial terms to `enrollment_assessments`. Existing assignments are backfilled from verified restored defaults. A validation trigger snapshots defaults for legacy inclusion calls and validates program/period matching, nonnegative amounts, fee-plus-credit equality, nonnegative adjusted payable, and a future credit year. `set_enrollment_assessment_terms` is admin-only, requires all terms and a reason, and preserves the existing audit trigger. Subscriber displays and internal exports resolve assignment terms, including an explicit zero credit; optional frontend fields allow reading older workspaces during deployment. Shared names, descriptions, due dates, references, and visibility still follow the assessment definition. Subscriber disclosures omit the shared description when it conflicts with individual financial terms.

Assessment defaults are the **new-enrollee terms**. From migration `202610220023`, approval assigns the active assessment at those defaults automatically. For 2026–27 the defaults are a ₦15,000 one-time CAC registration fee with no future credit. Earlier enrollees keep their snapshotted higher terms. **Enrollees → Adjust** still sets individual exceptions. Signed adjustments change the payable but do not change the assigned future credit.

The net assessment due for an enrollee is:

`assigned assessment contribution + HMO underpayment - HMO overpayment + admin adjustment - verified assessment payments`

The result is floored at zero for collection, while the underlying premium position remains visible. Future credit is a planned amount and should be described to subscribers as becoming available when the assessment is settled. A future enhancement may require a true credit ledger when the next enrollment year opens.

Sweeping the HMO premium variance into the assessment net is the **confirmed long-term accounting treatment** (decided 2026-09-16); it is not provisional and should not be removed without a new decision.

This combined figure is a **reconciliation position, not a payment instruction**. The program collects every payment into **one bank account**; HMO premiums and program assessments are distinguished only by the transfer reference the subscriber puts on the transfer, which is what makes the deposits reconcilable. The subscriber interface must therefore never present the combined net as a single amount to transfer, because the resulting payment would be recorded and referenced as an assessment while part of it is premium. `enrollmentFinancialPosition` also returns:

- `assessmentOwnNetKobo` / `assessmentOwnDueKobo`: `assessment base + admin adjustment - verified assessment payments`, which is what the subscriber transfers under the assessment reference;
- `premiumVarianceKobo`: the swept HMO under/overpayment, which is transferred under the HMO premium reference.

`assessmentOwnNetKobo + premiumVarianceKobo === assessmentNetKobo` always holds. Since 2026-10-22, `assessmentOwnDueKobo` is `max(0, assessmentOwnNetKobo − HMO overpayment)`. A member who sent the premium and the assessment in one HMO-referenced transfer is therefore not asked to pay the assessment again. A shortfall never raises it, because a shortfall belongs under the HMO reference. Subscriber-facing screens collect `assessmentOwnDueKobo`, disclose the premium variance separately, and show the combined position only as context. Administrator reports and exports continue to use `assessmentNetKobo`.

### 7.3 Late-enrollment proration and next-year credit

AVON's term for coverage year N is twelve months from 1 September N through 31 August N+1 (`enrollment_periods.coverage_starts_on`, default `N-09-01`, editable in settings). A late member pays the **full** annual subscriber total (premium + 1% NHIS + 2% program fee, all on the full premium). AVON bills the program only for the months from the coverage start month through August:

- billed months = 12 − months elapsed from the term start to the coverage start month;
- prorated premium = round(full premium × billed months / 12), to the kobo;
- prorated NHIS = round(prorated premium × NHIS rate);
- proration credit = (full premium + full NHIS) − (prorated premium + prorated NHIS).

The 2% program administrative fee is charged on the full premium, retained, and never part of the credit. Worked example matching AVON's supplementary-invoice method (Plus family annual rate ₦264,083, coverage Oct 2026 – Aug 2027): 11 months, ₦242,076.08 + ₦2,420.76 = ₦244,496.84 billed, credit ₦22,226.99 toward 2027.

The trigger `apply_enrollment_proration` stores `avon_billed_months`, `avon_prorated_premium_kobo`, `avon_prorated_nhis_kobo`, and `proration_credit_kobo` on every insert or update. A check constraint keeps them consistent with the stored premium and NHIS, and a start month outside the term is refused. The trigger's name sorts after `apply_enrollment_surcharges`, so it sees the final NHIS. `src/lib/proration.ts` reproduces the same calculation for previews and must stay identical.

### 7.3.1 Automatic next-year carry-forward

Migration `202610220024` carries each **submitted or closed** enrollment's balance into the same household's enrollment for the next coverage year. There it is applied automatically to the HMO premium position (`enrollmentFinancialPosition` counts `carryIn.netKobo` alongside verified premium payments). Balances are signed, and a positive balance is a credit:

- **Premium balance** = verified HMO payments + this year's carry-in − subscriber total. This captures exact over- and underpayments.
- **Assessment balance** = verified assessment payments − the assigned one-time fee − the signed adjustment.
  - A fully paid ₦33,000 contribution carries its ₦18,000 credit.
  - An unpaid one owes only the ₦15,000 fee, not the higher amount.
  - A partly paid one carries the difference either way.
  - A submitted enrollee never assigned the assessment owes the active assessment's default one-time fee.
- **Proration credit** = the stored late-enrollment credit.
- An HMO overpayment first covers an assessment balance owed (`overpaymentAppliedKobo`). This is how the late member's single combined transfer settles both obligations.
- **Net** = the sum of the three, applied as one figure.

Design properties:

- **Derived live**, not snapshotted. A late-verified prior-year payment updates the next year's position. Each balance is applied exactly once because a household has one enrollment per period, and the carry-in feeds that year's own carry-forward, so balances chain year to year.
- `enrollment_periods.carry_forward_enabled` is false for imported years (< 2026), so nothing older than 2026 ever carries.
- Pending and rejected payments, and draft enrollments, never carry anything.
- A balance owed (for example the ₦15,000 CAC fee) is collected in the next year as part of the HMO payable, under the HMO reference. The carry-forward components keep it distinguishable in reports and exports.
- When a 2027 assessment is configured, do not assign it to rolled-over households for the registration fee; their fee is already carried forward. New 2027 applicants get it at approval.

`public.enrollment_carry_forward` and `public.enrollment_carry_in` are internal: execution is revoked from clients. `get_enrollment_carry_forwards(p_period_id)` is the authenticated side-car read, scoped by `can_access_household`. `nextEnrollmentCarryForward` in `src/lib/financialPosition.ts` mirrors the SQL. `carryForwardMigration.test.ts` and `proration.test.ts` assert the same cases and values, so keep them identical.

Subscribers see a **Your {next year} enrollment** panel on Dashboard and Payments with the itemised carry-forward. A member with an unpaid higher CAC contribution is told that only the one-time ₦15,000 CAC registration fee is charged next year if it stays unpaid, and that paying now earns the ₦18,000 credit instead. Members who paid see their accurate credit. In the following year, the payable shows **Brought forward from {year}**, itemised, together with the payable after that balance.

### 7.4 One account, many references

`src/lib/paymentInstruction.ts` composes every payment instruction shown to a user: bank details always come from the single program `paymentAccount`, and only `referencePrefix` varies by purpose. Use it rather than reading an account off an assessment.

Migration `202609160021` removed the duplicate `beneficiary`, `bank`, and `account_number` columns from `financial_assessments`; an assessment now contributes only `reference_prefix`. `FinancialAssessment.referencePrefix` replaced the nested `paymentAccount`, so the type system no longer allows an assessment to name a different destination. `upsert_financial_assessment` requires a non-empty reference and rejects one matching the HMO premium reference, because a shared reference would make the two purposes impossible to reconcile apart in one account.

The migration refuses to run if any assessment still holds bank details differing from the program payment account, since dropping columns cannot be undone and divergence would mean the discarded copy was not in fact redundant.

HMO and assessment evidence use distinct, labeled upload actions. Both permit multiple confirmations. The administrator payment-review screen and exports identify the purpose.

## 8. 2026 operational state

Read-only verification on 2026-10-22, before migration `202610220023`:

- The 2026 period was `open` after a temporary reopen on 2026-10-10. Its audit history shows the original renewal window closed 2026-09-05 23:59 WAT, after an extension of the 2026-08-31 close.
- The seventh 2026 enrollment is the one late member, approved during that reopen, with fee-only ₦15,000 CAC terms already assigned.
- Their single verified transfer covered the full subscriber total plus the CAC fee, and the user confirmed the member has fully paid.
- AVON's supplementary invoice bills them from October 2026 for 11 months.
- The six earlier assignments keep their original terms, including the 2027 credit. The shared defaults were still the original contribution and credit.
- The exact identifiers, amounts and invoice reference are recorded only under ignored `.private/`.

Pending deployment action, private and ignored: `.private/apply-late-enrollment.ts` (preview, then `--apply`) does three things and verifies everything else in the period is unchanged:

1. Restores the original 2026-09-05 close and closes the period.
2. Records the late member's AVON coverage from 2026-10-01.
3. Sets the assessment defaults to the ₦15,000 fee-only new-enrollee terms.

Update this section once it has run.

Read-only verification on 2026-10-10: the 2026 period has been temporarily reopened and contains seven enrollments. The latest approved/submitted enrollment has no assessment assignment or payment records. Six earlier assessment assignments remain intact. Configuration audit history confirms a temporary reduction of the shared contribution/credit and a subsequent restoration to the original terms. Real account identifiers and exact operational mappings remain only under ignored `.private/` paths. The period must remain open until the administrator finishes the temporary enrollment work; this change does not close it.

After deployment on 2026-10-10, the latest enrollee was explicitly assigned the approved fee-only individual terms with no future enrollment credit. All seven enrollments now have an assessment assignment. The six earlier assignments retain their original financial terms and signed adjustments, and all seven pre-existing payment records, enrollment records, period settings, and shared assessment settings were independently compared before/after and are unchanged. The insertion is audited as an authorized system-maintenance action. The period remains open; no closure was performed.

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

On 2026-09-16 the 2026 roster was pruned to actual enrollees. The annual rollover creates a `draft` enrollment for every household carried forward, so the period also held seven rollover drafts for alumni who did not return for 2026. Each was verified inert before removal: `draft` status, zero payment records of any status, no consent, no submission, no assessment assignment, and six of the seven with no plan selected. Seven enrollments and twenty-one `enrollment_people` snapshots were deleted.

As of 2026-09-16, the 2026 period held exactly six `closed` enrollments. Verified HMO collections still totaled ₦1,577,991.18, all six assessment assignments were intact, and there were no orphaned payment or person-snapshot rows. Every affected household kept its 2025 enrollment and its household-scoped `people` records; twelve 2025 enrollments remained. The deletions are recorded as seven `enrollments.delete` audit events carrying full `old_data`, so the rows are reconstructible from the audit log.

Removal ran from ignored `.private/remove-2026-unenrolled.ts`, which previews by default, re-derives its target set at apply time, re-asserts every safety condition immediately before deleting, and aborts if the count changes or any matching record shows engagement.

The production reconciliation is intentionally stored only in ignored `.private/reconcile-2026.ts` because it contains real subscriber mappings and financial details. It is retained for audit/recovery context and must never be moved into tracked code, documentation, tests, issues, or commit messages.

## 9. Reporting and exports

All enrollee screens, reports, and exports are scoped to the administrator-selected enrollment year.

Exports:

- `Summary`: principal member only, selected plan/category, total owed, verified HMO paid, exact premium position, assessment paid/due, and future credit as applicable.
- `Admin full export`: all provider enrollment fields plus internal financial and administrative fields.
- Admin full and summary exports also carry late-enrollment and carry-forward columns: late flag, AVON coverage start, billed months, prorated premium and NHIS, proration credit, the balance brought forward from the prior year, and the carry-forward HMO balance, CAC balance and net. These are internal and excluded from the AVON export. AVON columns still show the annual premium; AVON's own supplementary invoice states the prorated bill.
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
- `202609160021`: dropped the duplicate assessment bank columns, leaving `reference_prefix`, and rebuilt `get_financial_workspace` and `upsert_financial_assessment` around the single program account. Guarded against divergent stored accounts.
- `202610100022`: snapshots individual assessment contribution, fee, credit, and year; adds validated admin-only individual-term mutation and period-scoped workspace fields. Deployed to production 2026-10-10.

- `202610220024`: automatic next-year carry-forward: `carry_forward_enabled` on periods (false before 2026), the internal `enrollment_carry_forward` and `enrollment_carry_in` functions, and the side-car read `get_enrollment_carry_forwards`. Wrapped in `BEGIN`/`COMMIT`. Deployed with `202610220023`; see the change log.
- `202610220023`: continuous late enrollment. It adds `coverage_starts_on` and `late_enrollment_open` to periods, and coverage-start and stored-proration columns to enrollments, with the `apply_enrollment_proration` trigger. It also adds:
  - the internal helpers `application_intake`, `late_coverage_start`, and `period_after_renewal_window`;
  - the admin-only `set_enrollment_coverage_start` and the side-car read `get_enrollment_coverage`.

  It rebuilds `get_public_join_config` (adds `enrollmentMode`, coverage dates, and the new-enrollee assessment amounts), `create_subscriber_application`, `get_admin_subscriber_applications`, `review_subscriber_application` (records the late coverage start and auto-assigns the assessment), and `update_enrollment_period`. It is wrapped in `BEGIN`/`COMMIT`. **Not yet deployed as of 2026-10-22.**

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

- 21 Vitest files, 157 unit/database/monitor tests passing, including embedded PostgreSQL migration, authorization, and workerd runtime tests. `src/test/migrationDatabase.ts` replays **every** migration into PGlite with synthetic auth/storage stubs, patching only the 2025 Vital data assertion in `202608250012`. It is used by `lateEnrollmentMigration.test.ts` and `carryForwardMigration.test.ts`.
- 26 Playwright scenarios passing: thirteen workflows at desktop and mobile sizes;
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

### External database monitor

`ops/supabase-monitor/` contains a Cloudflare scheduled Worker, focused tests, safe
probe/deployment commands, and the operational guide. Since 2026-10-22 the validator also accepts a `closed` period while `acceptingApplications` is true, but only with `enrollmentMode: 'late'`. **Redeploy the Worker before applying migration `202610220023`**, or the first late-enrollment response alerts as invalid. Its four-daily UTC schedule
is `17 1,7,13,19 * * *` (02:17, 08:17, 14:17, 20:17 Africa/Lagos). It makes a fresh
public `get_public_join_config` database request and validates open or closed
enrollment responses. Only a publishable key is used; no authentication activity,
subscriber reads, financial writes, or Supabase policy changes are involved.

The independent Healthchecks.io check must have project-email routing and a
23-hour period plus 1-hour grace. Its private UUID ping URL is a Worker secret.
Deployment preflight requires both a valid database response and acknowledged
heartbeat delivery. `npm run monitor:deploy -- --verify-only` verifies provider-side
configuration and a live request but is not proof of a Cron invocation; that
requires an actual Cloudflare event and matching heartbeat. Current deployment
state is recorded in the dated change log below. Cloudflare hosting access and
monitor routing are separate from the GitHub/Supabase deployment credentials.

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
- configure enrollment periods, the AVON coverage term start, whether new subscribers may join after the renewal window, and plan offerings;
- review late applicants with an expected proration preview, and correct a late member's AVON coverage start month to match AVON's invoice;
- configure the HMO payment account;
- configure a period assessment and the transfer reference that identifies its payments;
- include/exclude an enrollee from an assessment and enter a signed adjustment/note;
- change a subscriber's access email through the protected workflow;
- manage administrator roles subject to owner controls;
- act in a subscriber's workspace to complete their enrollment tasks when they cannot reach the portal, and record consent received offline;
- inspect audit history and daily unique sign-in activity.

Keep `docs/ADMIN_CHEATSHEET.md` aligned whenever an administrator workflow or label changes.

## 16. Known follow-ups and design cautions

- Carry-forwards are derived live (§7.3.1). If the program ever needs a balance frozen at a cut-off date, for example for audited year-end statements, add an explicit snapshot. Until then, a correction to a prior-year payment intentionally changes the next year's position, and is itself audited.
- A household that skips a year (no submitted enrollment in the immediately preceding year) carries nothing. Older balances do not jump a year.
- A former member returning after lapsing joins as a new applicant and is flagged by duplicate review. Approving them creates a new household, so reconcile such cases manually.
- `get_portal_snapshot` still prefers the latest coverage year when no period is open. Once a 2027 period is created as `scheduled`, verify that late 2026 members still see their 2026 enrollment and payments.
- The assessment model currently supports the active operational need. If multiple simultaneous assessments become common, replace any UI assumptions that select the first matching assessment with explicit selection and aggregation.
- Production reconciliation uses a system actor unless explicitly run through an authenticated admin operation. Audit display should make that distinction clear.
- Continue mobile-first testing. Most users access the portal by phone, and payment upload discoverability is a critical support burden.
- Continue provider-template regression tests whenever AVON changes its workbook fields or plan definitions.
- Consider further bundle splitting for ExcelJS and charting if mobile load performance becomes a problem.
- Before a new annual rollover, verify dates, offerings, rates, payment account, assessment status, hospital guidance, email copy, redirect URLs, SMTP, and exports in a non-production or dry-run path.
- Annual rollover creates a `draft` enrollment for every carried-forward household, including alumni who never return. Those drafts inflate the enrollee list, the administrator principal-member count, and the summary and admin-full exports until pruned. Plan to reconcile the roster after each enrollment period closes, and never prune on payment alone: check for pending payments, consent, and submission first, because an enrollment can be genuine and unpaid.
- `.env.local` on a developer machine may hold production Supabase credentials, with `VITE_DEMO_MODE=true` as the only thing preventing `npm run dev` from operating on live data. Prefer a separate non-production project for local work, and confirm demo mode before exercising any mutation locally.
- `relation` is free text for principals and dependents. AVON submissions and the family-composition rule (spouse plus up to four children under 21) would both benefit from a constrained vocabulary; dependent ages and relationships are currently unvalidated.
- `paymentPosition` reports `underpaid`, `paid in full`, and `overpaid`. §7.1 also describes an `unpaid` state for enrollments with no verified payment; it is currently reported as `underpaid`. Splitting it would change exported values, so it needs a deliberate decision.
- Enrollment edits are held in local component state with no unsaved-changes warning; navigating away discards them.
- The administrator application review shows dependent counts but not dependent identities, so a family application is approved without its household being visible.

### 2026-09-15 (administrators acting for subscribers)

Added the ability for an administrator to complete enrollment tasks for alumni who cannot reach the portal and send details manually (§4.1). No read or write permission needed changing: `can_access_household` already admitted administrators and `audit_row_change` already recorded `auth.uid()`, so attribution to the acting administrator was correct by construction. The work added the entry point, a sticky acting banner with a one-click exit, and consent provenance.

Migration `202609150020` adds `consent_channel`, `consent_recorded_by`, `consent_evidence_note`, and `consent_recorded_at` to `enrollments`, the `sync_consent_provenance` trigger, `record_offline_consent`, and `get_consent_records`. Existing consent is backfilled as `portal`.

`loadConsentRecords` degrades to an empty list when the RPC is unavailable. A side-car read for one administrator panel must never be able to blank the portal, including in the window between a frontend deploy and the migration that creates the function.

Deployed 2026-09-16: commit `bcbd45a`, GitHub Pages run `35059123871`, Supabase run `35059126416`. The preview step listed exactly `202609150020` and the apply step reported `Applying migration 202609150020_admin_acting_and_offline_consent.sql` with no other pending migration. Verified afterwards from an unauthenticated client: `get_consent_records` and `record_offline_consent` both return `42501 permission denied for function`, which confirms they exist in production and that anonymous execute is revoked, against a control name that returns `PGRST202` not found.

### 2026-09-16 (assessment reference cleanup)

Confirmed that sweeping the HMO premium variance into the assessment net (§7.2) is the intended long-term accounting treatment, and recorded it as settled rather than provisional.

Migration `202609160021` completes the single-account cleanup: the duplicate `beneficiary`, `bank`, and `account_number` columns are dropped from `financial_assessments`, leaving `reference_prefix` as the only per-assessment payment field. `get_financial_workspace` now returns `referencePrefix`, `upsert_financial_assessment` validates it and rejects one matching the HMO premium reference, and `FinancialAssessment.referencePrefix` replaced the nested `paymentAccount` in the frontend type.

The migration aborts if any stored assessment account still differs from the program payment account, because the drop cannot be undone.

## 17. Change log for this handoff

### 2026-10-22 (automatic next-year carry-forward)

The user asked for next-year credits to be applied automatically, both proration credits and the credits of members who paid the higher CAC, with exact premium over- and underpayments factored in. Subscribers are now told that an unpaid CAC becomes a ₦15,000 charge next year, and members who paid see their accurate credit.

Implemented migration `202610220024` (§7.3.1); the carry-in is applied in `enrollmentFinancialPosition` and in all subscriber and admin views. UI changes:

- the subscriber **Your {next year} enrollment** panel, wording a balance still owed as "carried into {year} unless paid";
- the **Brought forward** breakdown on the following year's payable;
- the admin **Carry to {next year}** column, legend, and HMO-position note.

Export columns now show brought-forward and carry-forward balances, replacing the earlier informational next-enrollment columns. The demo shows Ada with an ₦18,000 credit brought forward. The shared PGlite replay helper moved to `src/test/migrationDatabase.ts`.

Validation on 2026-10-22: `npm run check` passed (157 tests in 21 files), and `npm run test:e2e` passed all 26 scenarios. The PGlite suite covers each carry-forward rule on synthetic households:

- a fully paid higher CAC, an unpaid one, and a partial payment with a pending confirmation;
- premium over- and underpayment;
- the late member's single combined transfer;
- an unassigned enrollee, a draft, and imported 2025 data;
- a payment verified late, and chaining into 2028;
- isolation between subscribers, and refusal of anonymous and internal-function calls.

The private production script additionally asserts that the late member carries exactly +₦22,226.99 into 2027.

### 2026-10-22 (continuous late enrollment and AVON proration)

AVON keeps enrolling new members after the program's renewal window and bills them pro rata by month joined (a supplementary invoice covering Oct 2026 – Aug 2027 bills 11 of 12 months). The user asked for the following:

- New enrollments are always allowed.
- Late members are charged the full amount.
- The program's 2% fee stays on the full premium.
- The difference between the full premium + 1% NHIS and AVON's prorated premium + NHIS is stored as a credit toward the member's next enrollment.
- New enrollees pay a one-time ₦15,000 CAC fee with no credit.
- Earlier enrollees who never paid their higher CAC owe ₦15,000 when they re-enroll.

What was implemented:

- Migration `202610220023`, described in §5.1, §7.3 and §11.
- Join and home pages: a late-enrollment disclosure with an expected proration and the ₦15,000 registration-fee disclosure.
- Applications: a late banner, proration preview and approval prompt.
- Enrollees: a late badge and credit, a **Late enrollees** filter, and a **Coverage** editor with a live preview.
- Settings: the coverage-term start, the late-enrollment toggle and a live intake status.
- Subscriber Dashboard and Payments: a late-enrollment notice and the AVON breakdown.
- Admin overview: the intake status.
- Internal export columns.
- Fixed `assessmentOwnDueKobo` so an HMO overpayment that already covers the assessment is not requested again. This affected the late member, who paid both amounts in one transfer.
- Fixed unstyled `.checkbox-line` checkboxes, which rendered full-width in modals.
- Updated the monitor validator.

Validation on 2026-10-22: `npm run check` passed (lint, 139 tests in 20 files, monitor type checks, TypeScript, production build; existing chunk-size warnings only). `npm run test:e2e` passed all 24 desktop/mobile scenarios, including the new late-enrollment journey.

The PGlite suite proves the following:

- the invoice figures exactly;
- the full-term and out-of-term cases;
- recomputation after a surcharge-rate change;
- refusal of a term change that would orphan a late start;
- regular and late intake, the late-enrollment switch, and term expiry;
- late and regular approvals, including CAC auto-assignment;
- the audited admin coverage change, with subscriber and anonymous calls refused;
- isolation of coverage reads for two unrelated households, with the admin note hidden from subscribers.

Deployment sequence, all pending:

1. Push `main` and monitor GitHub Pages. The frontend degrades to full-term readings until the migration exists.
2. `npm run monitor:deploy` with the updated validator.
3. Dispatch the Supabase workflow and confirm the preview lists only `202610220023`.
4. Run `.private/apply-late-enrollment.ts` in preview mode, then with `--apply`.
5. Re-verify the join config, the late member's stored proration, and the unchanged rows, then update §8.

### 2026-10-19 (scheduled monitor history review)

Read-only provider verification confirmed the unchanged Worker, secret binding names, enabled invocation logs, and only the intended four-daily cron. After the user added Workers Observability access to the existing account-scoped token, a temporary/dry telemetry query retrieved execution history. As of 14:48 UTC, eleven routine invocations from 2026-10-16 19:17 UTC through 2026-10-19 07:17 UTC each had outcome `ok`, HTTP 200 on the first database attempt, and heartbeat `delivered` (database durations 649–1,864 ms). All four expected runs on October 17 and October 18 were present. The twelfth expected invocation, October 19 at 13:17 UTC, was absent from both the full and narrow-time-range Cloudflare log queries, but the user independently supplied Healthchecks.io event #93: received at 13:17:47.638948 UTC with `ok: true`, one database attempt, and 1,597 ms duration. All twelve expected routine slots are therefore accounted for; the latest slot has independent heartbeat evidence despite incomplete Cloudflare telemetry. A separate live public database probe at 14:31 UTC returned HTTP 200 on its first attempt. No manual heartbeat, alert, deployment, schedule change, subscriber access, or database write was performed. Private raw logs and the slot-comparison summary remain in ignored `.private/` files. No application code changed; application tests were not rerun for this audit.

### 2026-10-16 (external database monitoring)

Implemented a Cloudflare Worker outside Supabase to call the existing public `get_public_join_config` database RPC four times daily. The probe accepts closed enrollment as healthy, validates the response schema, uses only a publishable key, and performs no subscriber sign-ins or database writes. It has request timeouts, bounded retries, and sanitized metadata-only logging. No schema migration or authorization-policy change is needed.

An independent Healthchecks.io UUID heartbeat reports successful runs and failed checks, with project-email alerts and a 24-hour missed-success threshold (23-hour period plus 1-hour grace). The Worker has no public HTTP endpoint and no credentials capable of modifying Supabase data. Deployment is gated on a successful database/heartbeat preflight and verification of the actual Cloudflare schedule and secret bindings. Cloudflare credentials and the heartbeat URL stay under owner-readable ignored `.private/` paths or provider secret bindings, never public source, CLI arguments, or frontend configuration.

Validation on 2026-10-16: `npm run check` passed (104 tests in 17 files, lint, dedicated monitor type checks, TypeScript, and production build); `npm run test:e2e` passed all 22 desktop/mobile scenarios. Wrangler dry-run compiled a 4.95 KiB Worker bundle. A real publishable-key production probe returned HTTP 200 on its first attempt. Cloudflare account access and the independent heartbeat were subsequently configured through an owner-readable ignored file. Both live database and heartbeat preflight passed.

Worker `futo-hmo-supabase-monitor` was deployed on 2026-10-16. Provider API verification confirmed the intended cron, both secret binding names, and disabled public/preview URLs. With explicit user authorization, a clearly labelled failure/recovery test was accepted by Healthchecks.io at 15:55:35/15:55:45 UTC; fresh database probes stayed healthy throughout. The user confirmed receipt of both project-email notifications and supplied a dashboard screenshot confirming the 23-hour period, 1-hour grace, and enabled email integration.

Hosted validation subsequently exposed a Workers runtime incompatibility: `redirect: 'error'` throws immediately, despite Node accepting it. Both requests now use `redirect: 'manual'`, treating 3xx responses as failures without forwarding credentials. A synthetic workerd/Miniflare regression validates both request configurations, and focused tests cover refused redirects. After the correction, `npm run check` passed all 108 tests in 18 files plus lint, dedicated monitor type checks, TypeScript, and production build; `npm run test:e2e` again passed all 22 desktop/mobile scenarios.

Actual hosted scheduling was verified at 16:46:01 UTC on 2026-10-16: the Cloudflare Cron event completed with outcome `ok`, the production database returned HTTP 200 on its first attempt (1,469 ms), and Healthchecks.io acknowledged the success heartbeat. The ignored observer then removed the temporary minutely validation trigger and independently verified that only `17 1,7,13,19 * * *` remained. Private deployment, alert-test, event, and restoration evidence stays under `.private/`. Initial implementation commit `fdba654` passed GitHub Pages run `38928321400`; the final runtime correction is recorded in the following commit. No outstanding activation action remains. Free-plan checks remain a best-effort activity mechanism; only a paid Supabase plan removes inactivity pausing as a platform policy.

### 2026-10-10 (individual assessment terms)

Production read-only review confirmed shared assessment edits affected every assignment and application approval had left the latest enrollee unassigned. Added assignment snapshots and explicit individual fee/credit controls to preserve earlier obligations and support fee-only late-joiner exceptions. Subscriber payments/dashboard and summary/full administrator exports use assigned terms; zero-credit exceptions promise no future credit. Settings explain defaults versus shared details, and the admin guide documents explicit assessment assignment after approval. Also corrected the stale settings text that suggested separate bank accounts.

During review, fixed numeric editing across all affected forms: assessment-default amounts/year, surcharge percentages, individual-assessment credit year, and applicant graduation year now retain raw strings while editing. Clearing an input leaves it empty, decimals are not normalized on each keystroke, and validation distinguishes blank from an explicit zero before persistence. Individual monetary inputs already used strings; their save validation now uses the strict numeric parser too. Payment amount inputs are native uncontrolled fields and do not exhibit the forced-zero issue; the coverage year is read-only. Browser regression coverage checks clearing/retyping amounts, percentages, and years, and rejects saving a blank fee rate or individual credit amount.

Sequential-typing coverage also found that `Modal` refocused its first control whenever an inline `onClose` callback changed, stealing focus after each keystroke. Initial focus now runs only when the modal mounts; the Escape listener still tracks the latest close callback. This fixes ordinary typing across all dialogs, not just assessment inputs.

Validation on 2026-10-10: `npm run check` passed (lint, 74 tests in 16 files, TypeScript, production build). Fifteen embedded PostgreSQL tests execute migration `202610100022`, verify backfill/default isolation, explicit zero credit, audited insert/update, invalid/missing terms, anonymous/subscriber mutation denial, cross-program/period denial, and reads scoped to two unrelated subscriber households and the selected year. The new mobile/desktop browser scenario verifies explicit inclusion, reason validation, individual payable, preservation of another enrollee, and subscriber zero-credit disclosure. Synthetic demo data includes an unassigned late joiner to cover this flow. The existing bundle-size warnings remain.

Final `npm run test:e2e` passed on 2026-10-10: 22 scenarios across desktop and mobile, including sequential typing and blank-input validation. Code commit `08e29f6` deployed via Supabase run `38062593618` and GitHub Pages run `38062828252`. Migration preview listed exactly `202610100022`; apply completed successfully before publishing the frontend. A subsequent read-only preflight verified six earlier assignment snapshots and seven existing payments. Ignored `.private/apply-individual-assessment.ts` was previewed and then applied with every precondition rechecked; its post-apply comparison verified the fee-only assignment, zero future credit, and the system audit event while preserving every earlier assignment, enrollment, payment, period, and shared setting.

Independent live verification confirmed the deployed assets contain individual-term mutation, zero-credit disclosure, default isolation, and numeric-input validation. Anonymous `get_financial_workspace` and `set_enrollment_assessment_terms` execution both return `42501 permission denied for function`. Cross-household authorization was exercised with two unrelated synthetic identities in PostgreSQL, rather than signing in as real subscribers. Private scripts and owner-readable preflight/verification records remain ignored; the existing secret key is neither logged nor committed. No remaining release action; temporary enrollment closure remains an administrator decision, and the future credit-ledger follow-up in §16 still applies.

The first migration deployment (run `38062183231`) stopped at statement zero with `25P01` because the runner does not implicitly wrap `LOCK TABLE` in a transaction. No schema or data statement ran. The migration was corrected while still unapplied to include explicit `BEGIN`/`COMMIT`; the successful retry is recorded above. PostgreSQL regression setup now executes top-level statements individually to match deployment behavior.

### 2026-09-15 (UX, workflow, and reporting review)

A full review of subscriber, new-applicant, administrator, and owner journeys was run against demo mode only. No production read or write occurred; this was verified by inspecting outbound requests across every route plus a payment upload. Fixes applied:

- **Payment references.** The subscriber dashboard and payments screen led with the program assessment whenever one was assigned, presenting the combined reconciliation net (assessment base plus HMO shortfall) as a single amount to transfer under the assessment reference. Because the transfer reference is the only thing distinguishing the two obligations in one shared account, a subscriber following the interface would have sent premium money tagged as an assessment payment, leaving the premium recorded as underpaid and the deposit unreconcilable. Both screens now lead with whichever obligation is outstanding, ask for only `assessmentOwnDueKobo` under the assessment reference, and disclose the premium variance with its own reference. The reconciliation formula in §7.2 is unchanged.
- **Duplicate account storage.** Program settings collected bank details twice — once for HMO premiums and once per assessment — for what is a single program account, so the two copies could drift. The assessment now inherits the program account and configures only its transfer reference (§7.4).
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
