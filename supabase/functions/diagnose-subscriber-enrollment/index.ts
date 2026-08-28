import { createClient } from 'npm:@supabase/supabase-js@2';

const KEY_HASH = '4e41e4b067041a97a6b87c461af088ba461b7a8a0bd1821a734d6ba3babd72ab';
const REQUIRED_FIELDS = ['surname', 'firstName', 'middleName', 'dateOfBirth', 'gender', 'relation', 'nationality', 'address', 'country', 'state', 'town', 'lga', 'mobile', 'email'];

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
}

async function sha256(value: string) {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value));
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, '0')).join('');
}

function missingFields(person: Record<string, unknown>) {
  return REQUIRED_FIELDS.filter((field) => typeof person[field] !== 'string' || !(person[field] as string).trim());
}

Deno.serve(async (request) => {
  if (request.method !== 'POST') return json({ error: 'Method not allowed' }, 405);
  if (await sha256(request.headers.get('x-diagnostic-key') ?? '') !== KEY_HASH) return json({ error: 'Unauthorized' }, 401);

  const { email } = await request.json().catch(() => ({ email: '' }));
  const targetEmail = typeof email === 'string' ? email.trim().toLowerCase() : '';
  if (!targetEmail) return json({ error: 'Email is required' }, 400);

  const client = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!, { auth: { persistSession: false } });
  const { data: profiles, error: profileError } = await client.from('profiles').select('id,email').ilike('email', targetEmail).limit(2);
  if (profileError || profiles?.length !== 1) return json({ error: 'A unique subscriber profile was not found', profileCount: profiles?.length ?? 0 }, 409);
  const profile = profiles[0];
  const { data: authResult, error: authError } = await client.auth.admin.getUserById(profile.id);
  if (authError || authResult.user?.email?.toLowerCase() !== targetEmail) return json({ error: 'The profile and authentication email do not match' }, 409);

  const { data: program } = await client.from('programs').select('id').eq('slug', 'futo-alums-hmo').single();
  const { data: period } = await client.from('enrollment_periods').select('id,status,starts_at,ends_at').eq('program_id', program!.id).eq('coverage_year', 2026).single();
  const { data: links } = await client.from('account_households').select('household_id').eq('user_id', profile.id);
  const householdIds = (links ?? []).map((item) => item.household_id);
  if (!householdIds.length) return json({ accountVerified: true, householdCount: 0, error: 'No subscriber household is linked to this account' }, 409);

  const { data: enrollments, error: enrollmentError } = await client.from('enrollments')
    .select('id,household_id,category,status,plan_offering_id,hospital_name,consented_at')
    .eq('period_id', period!.id).in('household_id', householdIds);
  if (enrollmentError) return json({ error: enrollmentError.message }, 500);

  const enrollmentIds = (enrollments ?? []).map((item) => item.id);
  const { data: snapshots } = enrollmentIds.length
    ? await client.from('enrollment_people').select('enrollment_id,person_id,member_type,person_data').in('enrollment_id', enrollmentIds)
    : { data: [] };
  const { data: people } = await client.from('people').select('id,household_id,member_type').in('household_id', householdIds);
  const peopleById = new Map((people ?? []).map((person) => [person.id, person]));

  const diagnostics = (enrollments ?? []).map((enrollment) => {
    const records = (snapshots ?? []).filter((item) => item.enrollment_id === enrollment.id);
    const principalCount = records.filter((item) => item.member_type === 'Member').length;
    const dependents = records.filter((item) => item.member_type === 'Dependent');
    const invalidSnapshots = records.map((item, index) => ({
      role: item.member_type,
      index: item.member_type === 'Member' ? 0 : index,
      missingFields: missingFields(item.person_data as Record<string, unknown>),
    })).filter((item) => item.missingFields.length);
    const personLinkConflicts = records.filter((item) => {
      const person = peopleById.get(item.person_id);
      return person && person.household_id !== enrollment.household_id;
    }).length;
    const missingPeopleRows = records.filter((item) => !peopleById.has(item.person_id)).length;
    return {
      category: enrollment.category,
      status: enrollment.status,
      planSelected: Boolean(enrollment.plan_offering_id),
      hospitalEntered: Boolean(enrollment.hospital_name?.trim()),
      consentRecorded: Boolean(enrollment.consented_at),
      principalCount,
      dependentCount: dependents.length,
      invalidSnapshots,
      personLinkConflicts,
      missingPeopleRows,
    };
  });

  return json({
    accountVerified: true,
    householdCount: householdIds.length,
    periodStatus: period!.status,
    periodCurrentlyOpen: period!.status === 'open' && new Date(period!.starts_at) <= new Date() && new Date() <= new Date(period!.ends_at),
    enrollmentCount: diagnostics.length,
    enrollments: diagnostics,
  });
});
