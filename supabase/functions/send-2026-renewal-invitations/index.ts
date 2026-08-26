import { createClient } from 'npm:@supabase/supabase-js@2';

const CAMPAIGN_KEY = '2026-renewal-launch';
const PORTAL_URL = 'https://alentra-dev.github.io/futo-alums-hmo/';
const FROM = 'FUTO HMO Program <hmo@futo.9teen9ty.org>';

type Recipient = {
  userId: string;
  email: string;
  principalNames: string[];
  householdIds: string[];
};

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
}

function escapeHtml(value: string) {
  return value.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;').replaceAll('"', '&quot;').replaceAll("'", '&#039;');
}

function ratePercent(basisPoints: number) {
  return (basisPoints / 100).toLocaleString("en-NG", { maximumFractionDigits: 2 });
}

function message(firstName: string, actionLink: string, principalNames: string[], nhisRate: number, programRate: number, transactionRate: number) {
  const feeDisclosure = `${ratePercent(nhisRate)}% AVON NHIS fee, ${ratePercent(programRate)}% program fee, and ${ratePercent(transactionRate)}% banking transaction fee applied after the first two fees`;
  const managed = principalNames.length > 1
    ? `<p>Your email manages these principal records: <strong>${principalNames.map(escapeHtml).join(', ')}</strong>. Use the principal selector in the portal to complete each enrollment separately.</p>`
    : '';
  const html = `<!doctype html><html><body style="margin:0;background:#f3f6f4;color:#12231c;font-family:Arial,sans-serif"><table role="presentation" width="100%" cellspacing="0" cellpadding="0"><tr><td align="center" style="padding:28px 14px"><table role="presentation" width="620" style="max-width:620px;background:#fff;border:1px solid #dce5df"><tr><td style="background:#12372a;color:#fff;padding:22px 28px"><strong style="font-size:20px">FUTO Alums HMO Program</strong></td></tr><tr><td style="padding:30px 28px;line-height:1.55"><p>Hello ${escapeHtml(firstName)},</p><h1 style="font-size:25px;line-height:1.25;margin:0 0 16px">Complete your 2026 HMO enrollment</h1><p>The FUTO Alums HMO Program 2026 enrollment portal is now open.</p><p>This new application replaces the highly manual enrollment process used in 2025. Going forward, it will be the primary platform for annual renewals, new enrollments, information updates, and payment notifications.</p><p>Your 2025 enrollment information has already been securely loaded. You only need to review and update it for 2026.</p><p style="margin:26px 0"><a href="${actionLink}" style="display:inline-block;background:#1c6b4a;color:#fff;text-decoration:none;font-weight:bold;padding:13px 20px;border-radius:4px">Open my subscriber portal</a></p><p style="font-size:13px;color:#54665e">This private link is tied to your account, can be used only once, and should not be forwarded. If it expires or has already been used, visit <a href="${PORTAL_URL}">${PORTAL_URL}</a> and enter this same email address to request a new link.</p><p><strong>Please do not create a new subscriber account</strong>, as this may create a duplicate record.</p>${managed}<h2 style="font-size:19px;margin-top:28px">Complete your enrollment</h2><ol><li>Select your preferred 2026 AVON plan.</li><li>Review and update the principal member's information.</li><li>For family coverage, verify, add, update, or remove dependents.</li><li>Confirm your preferred hospital.</li><li>Review the subscriber total and submit your enrollment.</li><li>Upload a transaction confirmation for any payment already made.</li></ol><h2 style="font-size:19px;margin-top:28px">Payment information</h2><ul><li>Full payment is strongly encouraged; partial payments are discouraged.</li><li>Every full or partial payment must be reported through the portal.</li><li>If you already paid, confirm your plan and household first, then upload the transaction confirmation.</li><li>The subscriber total includes the disclosed ${feeDisclosure}.</li><li>Current payment account details are available securely inside the portal.</li></ul><p>The 2026 enrollment period is currently scheduled to close on <strong>31 August 2026</strong>. Final enrollment details will be provided to AVON after the enrollment period closes.</p><p>For privacy questions, contact <strong>Jude Oruoghor</strong>, Program Privacy Contact.</p><p style="margin-top:28px">Regards,<br><strong>FUTO Alums HMO Program</strong></p></td></tr></table></td></tr></table></body></html>`;
  const text = `Hello ${firstName},\n\nComplete your 2026 FUTO Alums HMO enrollment. This application replaces the manual process used in 2025 and will be used for annual renewals going forward. Your 2025 information is already loaded.\n\nOpen your private one-time portal link: ${actionLink}\n\nDo not forward this link or create a duplicate account. If the link expires, request another at ${PORTAL_URL}\n\nSelect a 2026 AVON plan, review the principal member, verify dependents for family coverage, confirm the hospital, submit the enrollment, and upload confirmation for any payment already made. Full payment is strongly encouraged. Every payment must be reported through the portal. Displayed totals include the disclosed ${feeDisclosure}.\n\nEnrollment is currently scheduled to close 31 August 2026.\n\nRegards,\nFUTO Alums HMO Program`;
  return { html, text };
}

Deno.serve(async (request) => {
  if (request.method !== 'POST') return json({ error: 'Method not allowed' }, 405);
  if (request.headers.get('x-batch-key') !== Deno.env.get('invitation_batch_key')) return json({ error: 'Unauthorized' }, 401);
  const { mode = 'dry_run' } = await request.json().catch(() => ({}));
  if (!['dry_run', 'send'].includes(mode)) return json({ error: 'Invalid mode' }, 400);

  const url = Deno.env.get('SUPABASE_URL')!;
  const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
  const resendKey = Deno.env.get('resend_api_key');
  const supabase = createClient(url, serviceKey, { auth: { persistSession: false } });

  const { data: program, error: programError } = await supabase.from('programs').select('id').eq('slug', 'futo-alums-hmo').single();
  if (programError) return json({ error: 'Unable to load program' }, 500);
  const { data: periods, error: periodError } = await supabase.from('enrollment_periods').select('id,coverage_year,nhis_fee_basis_points,program_fee_basis_points,transaction_tax_basis_points').eq('program_id', program.id).in('coverage_year', [2025, 2026]);
  if (periodError || periods?.length !== 2) return json({ error: 'Both 2025 and 2026 enrollment periods are required' }, 409);
  const period2025 = periods.find((item) => item.coverage_year === 2025)!;
  const period2026 = periods.find((item) => item.coverage_year === 2026)!;
  const { data: historical, error: historicalError } = await supabase.from('enrollments').select('id,household_id').eq('period_id', period2025.id);
  if (historicalError || !historical?.length) return json({ error: 'No 2025 enrollments found' }, 409);
  const householdIds = [...new Set(historical.map((item) => item.household_id))];
  const { data: current, error: currentError } = await supabase.from('enrollments').select('household_id').eq('period_id', period2026.id).in('household_id', householdIds);
  const { data: links, error: linksError } = await supabase.from('account_households').select('user_id,household_id').in('household_id', householdIds);
  const { data: principalRows, error: peopleError } = await supabase.from('enrollment_people').select('enrollment_id,person_data').eq('member_type', 'Member').in('enrollment_id', historical.map((item) => item.id));
  if (currentError || linksError || peopleError) return json({ error: 'Unable to validate subscriber mappings' }, 500);

  const currentHouseholds = new Set((current ?? []).map((item) => item.household_id));
  const enrollmentByHousehold = new Map(historical.map((item) => [item.household_id, item.id]));
  const principalByEnrollment = new Map((principalRows ?? []).map((item) => [item.enrollment_id, item.person_data as Record<string, string>]));
  const grouped = new Map<string, { householdIds: Set<string>; principalNames: Set<string> }>();
  for (const link of links ?? []) {
    const entry = grouped.get(link.user_id) ?? { householdIds: new Set<string>(), principalNames: new Set<string>() };
    entry.householdIds.add(link.household_id);
    const person = principalByEnrollment.get(enrollmentByHousehold.get(link.household_id)!);
    if (person) entry.principalNames.add([person.firstName, person.middleName, person.surname].filter(Boolean).join(' '));
    grouped.set(link.user_id, entry);
  }
  const userIds = [...grouped.keys()];
  const { data: profiles, error: profileError } = await supabase.from('profiles').select('id,email').in('id', userIds);
  if (profileError) return json({ error: 'Unable to load subscriber accounts' }, 500);

  const recipients: Recipient[] = [];
  let invalid = historical.length - (links?.length ?? 0);
  for (const profile of profiles ?? []) {
    const group = grouped.get(profile.id)!;
    const { data: authResult, error: authError } = await supabase.auth.admin.getUserById(profile.id);
    const authEmail = authResult.user?.email?.trim().toLowerCase();
    const profileEmail = profile.email.trim().toLowerCase();
    const completeRollover = [...group.householdIds].every((id) => currentHouseholds.has(id));
    if (authError || !authEmail || authEmail !== profileEmail || !completeRollover || !group.principalNames.size) { invalid += 1; continue; }
    recipients.push({ userId: profile.id, email: authEmail, principalNames: [...group.principalNames], householdIds: [...group.householdIds] });
  }

  const uniqueEmails = new Set(recipients.map((item) => item.email));
  if (uniqueEmails.size !== recipients.length) invalid += recipients.length - uniqueEmails.size;
  const { data: previousFailures } = await supabase.from('email_campaign_deliveries').select('error_message').eq('campaign_key', CAMPAIGN_KEY).eq('status', 'failed');
  const failureCategories = Object.entries((previousFailures ?? []).reduce<Record<string, number>>((counts, item) => {
    const category = item.error_message || 'Unspecified delivery failure';
    counts[category] = (counts[category] ?? 0) + 1;
    return counts;
  }, {})).map(([category, count]) => ({ category, count }));
  const validation = { accounts: recipients.length, households: householdIds.length, invalid, duplicates: recipients.length - uniqueEmails.size, resendConfigured: Boolean(resendKey), failureCategories };
  if (mode === 'dry_run') return json(validation, invalid === 0 ? 200 : 409);
  if (invalid > 0 || !resendKey) return json({ ...validation, error: 'Validation failed; no messages were sent' }, 409);

  let sent = 0; let skipped = 0; let failed = 0;
  for (const recipient of recipients) {
    const { data: prior } = await supabase.from('email_campaign_deliveries').select('status').eq('campaign_key', CAMPAIGN_KEY).eq('user_id', recipient.userId).maybeSingle();
    if (prior?.status === 'sent') { skipped += 1; continue; }
    await supabase.from('email_campaign_deliveries').upsert({ program_id: program.id, campaign_key: CAMPAIGN_KEY, user_id: recipient.userId, recipient_email: recipient.email, principal_names: recipient.principalNames, status: 'sending', error_message: null, updated_at: new Date().toISOString() }, { onConflict: 'campaign_key,user_id' });
    const { data: authResult, error: linkError } = await supabase.auth.admin.generateLink({ type: 'magiclink', email: recipient.email, options: { redirectTo: PORTAL_URL } });
    const actionLink = authResult.properties?.action_link;
    if (linkError || !actionLink) {
      failed += 1;
      await supabase.from('email_campaign_deliveries').update({ status: 'failed', error_message: 'Magic link generation failed', updated_at: new Date().toISOString() }).eq('campaign_key', CAMPAIGN_KEY).eq('user_id', recipient.userId);
      continue;
    }
    const firstName = recipient.principalNames.length === 1 ? recipient.principalNames[0].split(' ')[0] : 'FUTO Alum';
    const content = message(firstName, actionLink, recipient.principalNames, period2026.nhis_fee_basis_points, period2026.program_fee_basis_points, period2026.transaction_tax_basis_points);
    const response = await fetch('https://api.resend.com/emails', { method: 'POST', headers: { authorization: `Bearer ${resendKey}`, 'content-type': 'application/json' }, body: JSON.stringify({ from: FROM, to: [recipient.email], subject: 'Complete your 2026 FUTO Alums HMO enrollment', html: content.html, text: content.text }) });
    const result = await response.json().catch(() => ({}));
    if (!response.ok || !result.id) {
      failed += 1;
      await supabase.from('email_campaign_deliveries').update({ status: 'failed', error_message: `Email provider rejected request (${response.status})`, updated_at: new Date().toISOString() }).eq('campaign_key', CAMPAIGN_KEY).eq('user_id', recipient.userId);
    } else {
      sent += 1;
      await supabase.from('email_campaign_deliveries').update({ status: 'sent', provider_message_id: result.id, error_message: null, sent_at: new Date().toISOString(), updated_at: new Date().toISOString() }).eq('campaign_key', CAMPAIGN_KEY).eq('user_id', recipient.userId);
    }
    await new Promise((resolve) => setTimeout(resolve, 150));
  }
  return json({ ...validation, sent, skipped, failed }, failed === 0 ? 200 : 502);
});
