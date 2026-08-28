import { createClient } from 'npm:@supabase/supabase-js@2';

const KEY_HASH = 'd268dca83379bf11a3aaeb19452a35f869e37f9a007cbceba35cf0117402395c';
const TARGET_EMAIL = 'ezedesmond87@gmail.com';

function respond(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json', 'cache-control': 'no-store' } });
}

async function hash(value: string) {
  const bytes = new TextEncoder().encode(value);
  const digest = await crypto.subtle.digest('SHA-256', bytes);
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, '0')).join('');
}

Deno.serve(async (request) => {
  if (request.method !== 'POST') return respond({ error: 'Method not allowed' }, 405);
  const supplied = request.headers.get('x-diagnostic-key') ?? '';
  if (!supplied || await hash(supplied) !== KEY_HASH) return respond({ error: 'Not found' }, 404);

  const supabase = createClient(
    Deno.env.get('SUPABASE_URL')!,
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
    { auth: { persistSession: false, autoRefreshToken: false } },
  );
  const { data: profile, error: profileError } = await supabase
    .from('profiles').select('id,email').ilike('email', TARGET_EMAIL).maybeSingle();
  if (profileError) return respond({ error: profileError.message }, 500);
  if (!profile) return respond({ accountFound: false });

  const { data: applications, error: applicationError } = await supabase
    .from('subscriber_applications')
    .select('id,status,graduation_year,principal,dependents,plan_offering_id,category,hospital_name,updated_at,created_at,enrollment_periods!inner(coverage_year)')
    .eq('user_id', profile.id).order('created_at', { ascending: false });
  if (applicationError) return respond({ error: applicationError.message }, 500);

  const required = ['surname', 'firstName', 'dateOfBirth', 'gender', 'relation', 'nationality', 'address', 'country', 'state', 'town', 'lga', 'mobile', 'email'];
  const summaries = (applications ?? []).map((application) => {
    const person = (application.principal ?? {}) as Record<string, unknown>;
    const missing = required.filter((field) => !String(person[field] ?? '').trim());
    const mobileDigits = String(person.mobile ?? '').replace(/\D/g, '').length;
    const email = String(person.email ?? '').trim();
    return {
      id: application.id,
      year: (application.enrollment_periods as unknown as { coverage_year: number }).coverage_year,
      status: application.status,
      updatedAt: application.updated_at,
      graduationYear: application.graduation_year,
      missingFields: missing,
      middleNamePresent: Boolean(String(person.middleName ?? '').trim()),
      mobileDigitCount: mobileDigits,
      mobileValid: mobileDigits >= 10,
      principalEmailValid: email.includes('@') && email.indexOf('@') > 0,
      principalEmailMatchesAccount: email.toLowerCase() === TARGET_EMAIL,
      dateOfBirthValid: /^\d{4}-\d{2}-\d{2}$/.test(String(person.dateOfBirth ?? '')),
      genderValid: ['Male', 'Female'].includes(String(person.gender ?? '')),
      planSelected: Boolean(application.plan_offering_id),
      category: application.category,
      dependentCount: Array.isArray(application.dependents) ? application.dependents.length : null,
      hospitalPresent: Boolean(String(application.hospital_name ?? '').trim()),
    };
  });
  return respond({ accountFound: true, applicationCount: summaries.length, applications: summaries });
});
