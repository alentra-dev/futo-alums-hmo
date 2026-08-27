import { createClient } from 'npm:@supabase/supabase-js@2';

const ACCESS_EMAIL = 'info@prokleenltd.com';
const PRINCIPAL_NAME = 'steve nwabuike osuoha';
const KEY_HASH = '01d9557692f69bac6ed7e76ddb245cc7022425110a8d53fdbc2cc22b2fd8cc06';
const EVIDENCE = [
  { field: 'steve1', hash: 'c330c96d1d9b6c6307f213cf80ca158e1f9ef745807529bffe5b26153d7b5abb', amountKobo: 25000000, paidAt: '2026-08-12', reference: 'EXTRF|1786561011735127' },
  { field: 'steve2', hash: '4cd4a24bbe8a3b061e574618e5b8c116595578ed91a4d98faa76f33f602bad3d', amountKobo: 17645300, paidAt: '2026-08-26', reference: 'EXTRF|1787769491212133' },
] as const;

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
}
async function hashBytes(bytes: ArrayBuffer) {
  return [...new Uint8Array(await crypto.subtle.digest('SHA-256', bytes))]
    .map((byte) => byte.toString(16).padStart(2, '0')).join('');
}
async function sha256(value: string) {
  return hashBytes(new TextEncoder().encode(value).buffer);
}
function personName(person: Record<string, string>) {
  return [person.firstName, person.middleName, person.surname].filter(Boolean).join(' ').trim().toLowerCase().replaceAll(/\s+/g, ' ');
}

Deno.serve(async (request) => {
  if (request.method !== 'POST') return json({ error: 'Method not allowed' }, 405);
  const key = request.headers.get('x-manual-upload-key') ?? '';
  if (await sha256(key) !== KEY_HASH) return json({ error: 'Unauthorized' }, 401);
  const form = request.headers.get('content-type')?.includes('multipart/form-data') ? await request.formData() : null;
  const action = form?.get('action') === 'process' ? 'process' : 'inspect';

  const supabase = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!, { auth: { persistSession: false } });
  const { data: profiles, error: profileError } = await supabase.from('profiles').select('id,email').ilike('email', ACCESS_EMAIL).limit(2);
  if (profileError || profiles?.length !== 1) return json({ error: 'Unique access account not found' }, 409);
  const profile = profiles[0];
  const { data: authResult, error: authError } = await supabase.auth.admin.getUserById(profile.id);
  if (authError || authResult.user?.email?.toLowerCase() !== ACCESS_EMAIL) return json({ error: 'Auth and profile email do not match' }, 409);

  const { data: program } = await supabase.from('programs').select('id').eq('slug', 'futo-alums-hmo').single();
  const { data: period } = await supabase.from('enrollment_periods').select('id,coverage_year').eq('program_id', program!.id).eq('coverage_year', 2026).single();
  const { data: links } = await supabase.from('account_households').select('household_id').eq('user_id', profile.id);
  const householdIds = (links ?? []).map((item) => item.household_id);
  const { data: enrollments } = await supabase.from('enrollments')
    .select('id,household_id,plan_offering_id,category,status,subscriber_total_kobo,premium_kobo,nhis_fee_kobo,reserve_fee_kobo,hospital_name,consented_at')
    .eq('period_id', period!.id).in('household_id', householdIds);
  const enrollmentIds = (enrollments ?? []).map((item) => item.id);
  const { data: people } = await supabase.from('enrollment_people').select('enrollment_id,person_data').eq('member_type', 'Member').in('enrollment_id', enrollmentIds);
  const matches = (people ?? []).filter((item) => personName(item.person_data as Record<string, string>) === PRINCIPAL_NAME);
  if (matches.length !== 1) return json({ error: 'Unique exact enrollment not found' }, 409);
  const enrollment = enrollments!.find((item) => item.id === matches[0].enrollment_id)!;

  const { data: plans } = await supabase.from('plan_offerings')
    .select('id,code,name,individual_premium_kobo,family_premium_kobo,nhis_fee_basis_points,reserve_fee_basis_points,active')
    .eq('period_id', period!.id).order('sort_order');
  const premiumPlan = (plans ?? []).filter((plan) => plan.code === 'PREMIUM' && plan.active);
  if (premiumPlan.length !== 1) return json({ error: 'Unique active Premium Plan not found' }, 409);
  const plan = premiumPlan[0];
  const { data: existingPayments } = await supabase.from('payments')
    .select('id,amount_kobo,paid_at,reference,proof_path,status,created_at').eq('enrollment_id', enrollment.id).order('created_at');

  if (action === 'process') {
    const files = new Map<string, { file: File; bytes: ArrayBuffer }>();
    for (const evidence of EVIDENCE) {
      const file = form!.get(evidence.field);
      if (!(file instanceof File) || file.type !== 'image/jpeg' || file.size <= 0 || file.size > 10 * 1024 * 1024) {
        return json({ error: `Valid JPEG evidence is required for ${evidence.field}` }, 400);
      }
      const bytes = await file.arrayBuffer();
      if (await hashBytes(bytes) !== evidence.hash) return json({ error: `Evidence hash mismatch for ${evidence.field}` }, 409);
      files.set(evidence.field, { file, bytes });
    }

    const premiumKobo = plan.family_premium_kobo;
    const nhisKobo = Math.round(premiumKobo * plan.nhis_fee_basis_points / 10000);
    const programKobo = Math.round(premiumKobo * plan.reserve_fee_basis_points / 10000);
    const { error: planError } = await supabase.from('enrollments').update({
      plan_offering_id: plan.id,
      category: 'family',
      premium_kobo: premiumKobo,
      nhis_fee_kobo: nhisKobo,
      reserve_fee_kobo: programKobo,
      subscriber_total_kobo: premiumKobo + nhisKobo + programKobo,
      updated_at: new Date().toISOString(),
    }).eq('id', enrollment.id);
    if (planError) return json({ error: 'Unable to select Premium family plan' }, 500);

    const results = [];
    for (const evidence of EVIDENCE) {
      const duplicate = (existingPayments ?? []).find((payment) => payment.reference === evidence.reference);
      if (duplicate) {
        results.push({ reference: evidence.reference, paymentId: duplicate.id, status: duplicate.status, existing: true });
        continue;
      }
      const item = files.get(evidence.field)!;
      const proofPath = `${enrollment.id}/manual-${evidence.paidAt}-${evidence.hash.slice(0, 12)}.jpeg`;
      const { error: uploadError } = await supabase.storage.from('payment-proofs').upload(proofPath, item.bytes, { contentType: item.file.type, upsert: false });
      if (uploadError && !uploadError.message.toLowerCase().includes('already exists')) return json({ error: `Unable to upload ${evidence.field}` }, 500);
      const { data: payment, error: paymentError } = await supabase.from('payments').insert({
        enrollment_id: enrollment.id,
        amount_kobo: evidence.amountKobo,
        paid_at: evidence.paidAt,
        reference: evidence.reference,
        proof_path: proofPath,
        status: 'pending',
        submitted_by: profile.id,
      }).select('id,status').single();
      if (paymentError) return json({ error: `Unable to record ${evidence.field}` }, 500);
      await supabase.from('notification_outbox').insert({
        program_id: program!.id,
        event_type: 'payment.submitted',
        payload: { payment_id: payment.id, enrollment_id: enrollment.id, amount_kobo: evidence.amountKobo, submitted_on_behalf: true },
      });
      results.push({ reference: evidence.reference, paymentId: payment.id, status: payment.status, existing: false });
    }
    return json({ completed: true, plan: { code: plan.code, name: plan.name, category: 'family' }, totalKobo: premiumKobo + nhisKobo + programKobo, payments: results });
  }

  return json({
    accountVerified: true,
    enrollment,
    selectedPlan: (plans ?? []).find((item) => item.id === enrollment.plan_offering_id) ?? null,
    intendedPlan: { code: plan.code, name: plan.name, category: 'family' },
    payments: existingPayments ?? [],
  });
});
