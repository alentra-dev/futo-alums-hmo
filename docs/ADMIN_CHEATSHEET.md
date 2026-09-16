# FUTO Alums HMO Program: Admin Quick Guide

Portal: https://alentra-dev.github.io/futo-alums-hmo/

Use **Admin workspace** in the left navigation after signing in. Subscriber health, family, contact, and payment data is confidential. Use the portal rather than WhatsApp or personal spreadsheets for storing or sharing these details.

## Daily 10-minute checklist

1. Open **New subscribers** and resolve applications marked **Pending review**.
2. Open **Payment review**, compare every pending proof with the custodian's bank record, then verify or reject it.
3. Open **Enrollees** and look for draft records, missing plan selections, and people who have not submitted.
4. Check the dashboard totals and upcoming enrollment deadline.
5. Use **Audit history** when a change, approval, or payment decision needs to be traced.

## Admin screens at a glance

| Screen | Use it for |
|---|---|
| **Overview** | Current-year enrollment totals, collections, plan distribution, deadline, and pending-payment shortcuts |
| **New subscribers** | Review applicants, investigate possible duplicates, request corrections, approve, or mark duplicates |
| **Enrollees** | Search enrollment records, change reporting year, review status, and download reports or exports |
| **Payment review** | Open evidence, distinguish HMO/assessment payments, verify or reject notifications, or upload for a subscriber |
| **Portal activity** | Review daily unique sign-ins and distinguish subscriber-linked, applicant, and admin-only activity |
| **Subscriber access** | Change the email used to sign in without changing AVON enrollment email history |
| **Audit history** | Trace who changed what and when |
| **Program settings** | Manage time zone, HMO fees, program assessments, enrollment dates/status, annual rollover, and payment accounts |
| **Administrator access** | Owner-only control for adding or removing administrators |

## New subscriber review

1. Filter to **Pending review**.
2. Confirm the applicant through the alumni WhatsApp group when necessary.
3. Review the principal, selected plan, coverage type, dependents, hospital, phone, and account email.
4. If duplicate warnings appear, compare the birthday, phone, email, existing principal, and managing account.
5. Choose the appropriate action:
   - **Approve subscriber**: creates and activates the submitted enrollment.
   - **Request changes**: enter a clear note first; the applicant can correct and resubmit.
   - **Mark duplicate**: closes the application as a duplicate. Use only after confirming the match.

Do not approve an application merely because the name looks familiar. Resolve every duplicate warning first.

## Enrollees and exports

1. Select the **Enrollment year** before reviewing or downloading anything.
2. Search by member name or email, or filter by enrollment status.
3. Confirm the member's plan, **Individual/Family** type, household size, HMO total, exact under/overpayment, assessment balance, hospital, and status.
4. Download the appropriate workbook:
   - **Summary**: principal member, plan/category, HMO payable/verified/position, assessment paid/due, future credit, and status.
   - **Admin full export**: complete enrollment fields plus internal HMO and assessment accounting fields.
   - **AVON export**: AVON-ready fields only; excludes payment, assessment, and other internal administration fields and includes only submitted or closed enrollments.

Important:

- Every export uses the selected enrollment year.
- Search and status filters change the on-screen list but do **not** limit exported rows.
- Review the AVON workbook before sending it.
- Do not email or post the Admin Full Export in group chats.

### Enrollment statuses

| Status | Meaning |
|---|---|
| **Draft** | Subscriber has not completed and submitted the enrollment |
| **Submitted** | Subscriber completed the enrollment; eligible for the AVON export |
| **Closed** | Finalized enrollment retained after closure |
| **Not selected** | No plan has been chosen; follow up before accepting the enrollment as complete |

## Payment review

For every pending payment:

1. Select **View proof**.
2. Confirm whether it is an **HMO premium** or **program assessment**, then match the subscriber, amount, payment date, transfer reference, correct beneficiary account, and bank transaction.
3. Check the custodian's bank record independently.
4. Select:
   - **Verify** only when the bank record and uploaded evidence agree.
   - **Reject** when the payment cannot be matched or the evidence is incorrect.

Guidance:

- Each partial payment appears separately and must be reviewed separately.
- Subscribers may upload more than two confirmations; there is no fixed payment-count limit.
- A proof link is temporary; reopen **View proof** if it expires.
- Pending payments do not count as verified collections.
- Never verify solely from a screenshot without confirming receipt in the program account.
- If the subscriber selected no plan or remains in draft, ask them to finish and submit enrollment even if payment has already been made.

### Upload for a subscriber

Use **Upload for subscriber** only when support is necessary:

1. Select the subscriber and payment purpose: HMO premium or the named assessment.
2. Enter the exact amount and payment date, add the transfer reference, and attach the evidence supplied by the subscriber.
3. Upload it for review, then verify it only after independently confirming receipt in the matching account.

The upload is still a separate audit and review event. Do not combine multiple transfers into one record.

## Subscriber account access

Use this only when a subscriber has lost access to the current login email.

1. Search by principal name or account email.
2. Select **Change email**.
3. Enter and confirm the new address.
4. Confirm every principal managed by that account.
5. Leave **Send a fresh one-time portal sign-in link** selected unless there is a specific reason not to.
6. Confirm the change.

This changes portal authentication for all households linked to that account. It does **not** overwrite current or historical AVON enrollment email fields. Do not create a replacement account, because that can create duplicate subscribers.

## Portal activity

- **Today**, **Last 7 days**, and **Last 30 days** show unique authenticated accounts.
- **Returning** means active on at least two days in the last 30 days.
- Use the **7 / 30 / 90 day** control to change the chart and recent-account window.
- **Subscriber-linked** includes any account connected to a subscriber household, including an administrator who is also a subscriber.
- **Admin/owner only** means the account has no subscriber household.
- Each account is counted once per day at midnight in the program's configured time zone.

Activity measures portal use, not completed enrollment or payment.

## Audit history

Use search to locate an administrator, subscriber, email, payment, or action. Each event shows:

- The action and affected record
- The actor's name and email
- The event type
- The date and time in the configured program time zone

The audit log is append-only. Use it to investigate disputed changes, payment decisions, access-email changes, approvals, and configuration updates.

## Program settings

Treat these as high-impact controls.

### Time zone

Controls displayed deadlines, daily activity cut-offs, reports, and audit timestamps. The normal setting is **Africa/Lagos (WAT)**.

### Fee rates

The current charges are configured independently:

- AVON NHIS fee
- Program administrative fee

Saving rates immediately recalculates totals and outstanding balances for that year. Existing payment records are preserved. Confirm the approved rates before saving.

The finalized 2026 HMO fee model is 1% AVON NHIS plus 2% program administration. A separate CAC/program assessment is not an HMO percentage fee.

### Program assessment

Use this section for a distinct non-premium contribution such as CAC/entity-registration costs. Configure its name, description, base amount, retained fee portion, future-enrollment credit, credit year, due date, active state, and dedicated payment account.

Use **Enrollees** to include or exclude a subscriber and to enter a signed adjustment with a clear note. The displayed net amount combines the assessment base, exact HMO under/overpayment, any administrator adjustment, and verified assessment payments. Do not use an adjustment to hide a payment; record every transfer as a payment confirmation.

### Enrollment period

- **Scheduled**: configured but not open.
- **Open**: subscribers can update and submit.
- **Closed**: subscribers can no longer change or submit enrollment details.

Administrators may adjust opening and closing dates and add an extension or closure note. Confirm that outstanding subscriber work has been resolved before closing.

### Plan offerings and annual rollover

**Create next enrollment year** copies the current offerings and subscriber households into the next year as the starting point. Before opening the new year, verify the dates, fees, prices, benefits, active plans, and payment account against the new provider proposal.

### HMO payment account

Confirm the account name, bank, 10-digit account number, and transfer-reference prefix before saving. This account is for HMO premiums. An active program assessment can have a different account, so verify which purpose a subscriber selected before reviewing evidence.

## Administrator access

Only the owner should use **Administrator access**.

- **Make admin** promotes an existing program account.
- **Remove admin** returns an administrator to subscriber access.
- The primary owner cannot be removed from this screen.

Give admin access only to people actively performing program administration. Remove it promptly when their role ends.

## Enrollment close checklist

1. Resolve every pending new-subscriber application.
2. Follow up on draft enrollments and missing plans.
3. Review all pending payment evidence.
4. Reconcile HMO and assessment collections separately against their respective bank accounts.
5. Download and review the selected year's **Summary** and **Admin full export**.
6. Confirm all AVON-bound records are submitted and complete.
7. Close the enrollment period in **Program settings**.
8. Generate a fresh **AVON export** after closure and perform a final review.
9. Send only the AVON export to AVON through the approved secure channel.
10. Retain records according to the program's seven-year retention policy.

## Safety rules

- Never share magic links, payment proofs, Admin Full Exports, or family details in group chats.
- Never change fees, dates, payment accounts, or admin access without authorization.
- Never approve a suspected duplicate until it has been resolved.
- Never verify a payment without checking the custodian's bank record.
- Never provide consent or attest to family details on a subscriber's behalf.
