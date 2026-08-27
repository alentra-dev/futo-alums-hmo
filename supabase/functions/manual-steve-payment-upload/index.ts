import { createClient } from 'npm:@supabase/supabase-js@2';

const ACCESS_EMAIL = 'info@prokleenltd.com';
const PRINCIPAL_NAME = 'steve nwabuike osuoha';
const KEY_HASH = '01d9557692f69bac6ed7e76ddb245cc7022425110a8d53fdbc2cc22b2fd8cc06';

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
}

async function sha256(value: string) {
  const bytes = new TextEncoder().encode(value);
  return [...new Uint8Array(await crypto.subtle.digest('SHA-256', bytes))]
    .map((byte) => byte.toString(16).padStart(2, '0')).join('');
}

function personName(person: Record<string, string>) {
  return [person.firstName, person.middleName, person.surname].filter(Boolean).join(' ').trim().toLowerCase().replaceAll(/\s+/g, ' ');
}

Deno.serve(async (request) => {
  if (request.method !== 'POST') return json({ error: 'Method not allowed' }, 405);
  const key = request.headers.get('x-manual-upload-key') ?? '';
  if (await sha256(key) !== KEY_HASH) return json({ error: 'Unauthorized' }, 401);

  const supabase = createClient(
    Deno.env.get('SUPABASE_URL')!,
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
    { auth: { persistSession: false } },
  );

  const { data: profiles, error: profileError } = await supabase.from('profiles')
    .select('id,email').ilike('email', ACCESS_EMAIL).limit(2);
  if (profileError || profiles?.length !== 1) return json({ error: 'Unique access account not found' }, 409);
  const profile = profiles[0];
  const { data: authResult, error: authError } = await supabase.auth.admin.getUserById(profile.id);
  if (authError || authResult.user?.email?.toLowerCase() !== ACCESS_EMAIL) {
    return json({ error: 'Auth and profile email do not match' }, 409);
  }

  const { data: program } = await supabase.from('programs').select('id').eq('slug', 'futo-alums-hmo').single();
  const { data: period } = await supabase.from('enrollment_periods').select('id,coverage_year,nhis_fee_basis_points,program_fee_basis_points')
    .eq('program_id', program!.id).eq('coverage_year', 2026).single();
  const { data: links } = await supabase.from('account_households').select('household_id').eq('user_id', profile.id);
  const householdIds = (links ?? []).map((item) => item.household_id);
  const { data: enrollments } = await supabase.from('enrollments')
    .select('id,household_id,plan_offering_id,category,status,subscriber_total_kobo,premium_kobo,nhis_fee_kobo,reserve_fee_kobo,hospital_name,consented_at')
    .eq('period_id', period!.id).in('household_id', householdIds);
  const enrollmentIds = (enrollments ?? []).map((item) => item.id);
  const { data: people } = await supabase.from('enrollment_people').select('enrollment_id,person_data')
    .eq('member_type', 'Member').in('enrollment_id', enrollmentIds);
  const matches = (people ?? []).filter((item) => personName(item.person_data as Record<string, string>) === PRINCIPAL_NAME);
  if (matches.length !== 1) return json({ error: 'Unique Steve Osuoha enrollment not found', householdCount: householdIds.length, enrollmentCount: enrollments?.length ?? 0, principals: (people ?? []).map((item) => ({ enrollmentId: item.enrollment_id, name: personName(item.person_data as Record<string, string>) })) }, 409);
  const enrollment = enrollments!.find((item) => item.id === matches[0].enrollment_id)!;

  const { data: plans } = await supabase.from('plan_offerings')
    .select('id,code,name,individual_premium_kobo,family_premium_kobo,nhis_fee_basis_points,reserve_fee_basis_points,active')
    .eq('period_id', period!.id).order('sort_order');
  const { data: payments } = await supabase.from('payments')
    .select('id,amount_kobo,paid_at,reference,proof_path,status,created_at')
    .eq('enrollment_id', enrollment.id).order('created_at');

  return json({
    accountVerified: true,
    enrollment,
    selectedPlan: (plans ?? []).find((plan) => plan.id === enrollment.plan_offering_id) ?? null,
    plans: (plans ?? []).map((plan) => ({
      code: plan.code,
      name: plan.name,
      active: plan.active,
      individualPremiumKobo: plan.individual_premium_kobo,
      individualTotalKobo: Math.round(plan.individual_premium_kobo * (10000 + plan.nhis_fee_basis_points + plan.reserve_fee_basis_points) / 10000),
      familyPremiumKobo: plan.family_premium_kobo,
      familyTotalKobo: Math.round(plan.family_premium_kobo * (10000 + plan.nhis_fee_basis_points + plan.reserve_fee_basis_points) / 10000),
    })),
    payments: payments ?? [],
  });
});
