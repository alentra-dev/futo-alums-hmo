# FUTO Alums HMO Program

Private annual healthcare enrollment and payment administration for the FUTO alumni program. The frontend is deployed through GitHub Pages; authentication, private data, payment proofs, authorization, and audit records live in Supabase.

## Local development

```bash
npm install
cp .env.example .env.local
npm run dev
```

Set `VITE_DEMO_MODE=true` for synthetic local records. Never place a Supabase service-role key in a `VITE_` variable.

## Production setup

1. Apply the SQL files in `supabase/migrations` to the Supabase project in filename order.
2. Configure the GitHub repository variables `VITE_SUPABASE_URL` and `VITE_SUPABASE_ANON_KEY`.
3. Add `https://alentra-dev.github.io/futo-alums-hmo/` to Supabase Auth redirect URLs.
4. Run the private 2025 import only after migrations and redirect URLs are verified.
5. Enable GitHub Pages with **GitHub Actions** as its source.

## Private historical import

Dry-run validation writes an ignored, owner-readable preview under `.private/`:

```bash
npm run import:2025 -- "/path/to/Enrollee Onboarding Template.xlsx"
```

The live import requires the service-role key only in the local process environment. It creates 2025 closed records, rolls demographics into 2026 drafts, links shared account emails, configures administrators and the payment account, and sends account invitations.

```bash
SUPABASE_URL="https://project.supabase.co" \
SUPABASE_SERVICE_ROLE_KEY="..." \
OWNER_EMAIL="..." \
ADMIN_EMAILS="admin1@example.com,admin2@example.com" \
PAYMENT_ACCOUNT_NAME="..." \
PAYMENT_BANK="..." \
PAYMENT_ACCOUNT_NUMBER="..." \
npm run import:2025 -- "/path/to/workbook.xlsx" --apply --invite
```

Real records, exports, receipts, credentials, and account configuration are excluded by `.gitignore` and must never enter Git history.

## Core controls

- One verified account may manage multiple principal-member households.
- Subscribers can access only linked households; admins access only their program.
- Payment proofs use a private storage bucket with row-level policies.
- Every financial, enrollment, plan, period, account, and role change is audited.
- Prices and fees are snapshotted per enrollment in integer kobo.
- Prior years remain immutable after closure and can seed a new draft period.
