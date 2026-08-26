import { createClient } from 'npm:@supabase/supabase-js@2';

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
}

Deno.serve(async (request) => {
  if (request.method !== 'POST') return json({ error: 'Method not allowed' }, 405);
  if (request.headers.get('x-operation-key') !== Deno.env.get('account_email_change_key')) return json({ error: 'Unauthorized' }, 401);

  const body = await request.json().catch(() => ({}));
  const mode = body.mode === 'apply' ? 'apply' : 'dry_run';
  const oldEmail = String(body.oldEmail ?? '').trim().toLowerCase();
  const newEmail = String(body.newEmail ?? '').trim().toLowerCase();
  const actorEmail = String(body.actorEmail ?? '').trim().toLowerCase();
  if (!EMAIL_PATTERN.test(oldEmail) || !EMAIL_PATTERN.test(newEmail) || !EMAIL_PATTERN.test(actorEmail) || oldEmail === newEmail) {
    return json({ error: 'Two different account emails and a valid administrator email are required' }, 400);
  }

  const supabase = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!, {
    auth: { persistSession: false },
  });
  const { data: oldProfile, error: oldProfileError } = await supabase.from('profiles').select('id,email').ilike('email', oldEmail).maybeSingle();
  if (oldProfileError || !oldProfile) return json({ error: 'The existing subscriber account was not found' }, 404);
  const { data: duplicateProfile, error: duplicateError } = await supabase.from('profiles').select('id').ilike('email', newEmail).maybeSingle();
  if (duplicateError) return json({ error: 'Unable to validate the replacement email' }, 500);
  if (duplicateProfile && duplicateProfile.id !== oldProfile.id) return json({ error: 'The replacement email already belongs to another account' }, 409);

  const { data: authResult, error: authError } = await supabase.auth.admin.getUserById(oldProfile.id);
  if (authError || authResult.user?.email?.trim().toLowerCase() !== oldEmail) {
    return json({ error: 'The Auth identity does not match the existing profile' }, 409);
  }
  const { data: householdLinks, error: linksError } = await supabase.from('account_households').select('household_id').eq('user_id', oldProfile.id);
  if (linksError || !householdLinks?.length) return json({ error: 'The account is not linked to a subscriber household' }, 409);

  const householdIds = householdLinks.map((item) => item.household_id);
  const { data: households, error: householdsError } = await supabase.from('households').select('program_id').in('id', householdIds);
  if (householdsError || !households?.length || new Set(households.map((item) => item.program_id)).size !== 1) {
    return json({ error: 'Unable to validate the subscriber program' }, 409);
  }
  const programId = households[0].program_id;
  const { data: actor, error: actorError } = await supabase.from('profiles').select('id,email').ilike('email', actorEmail).maybeSingle();
  if (actorError || !actor) return json({ error: 'The administrator account was not found' }, 404);
  const { data: membership, error: membershipError } = await supabase.from('program_memberships').select('role').eq('program_id', programId).eq('user_id', actor.id).eq('active', true).in('role', ['admin', 'owner']).maybeSingle();
  if (membershipError || !membership) return json({ error: 'The actor is not an active program administrator' }, 403);

  const result = { userId: oldProfile.id, householdCount: householdIds.length, actor: actor.email, historicalEnrollmentDataChanged: false };
  if (mode === 'dry_run') return json({ ...result, ready: true });

  const { data: updated, error: updateError } = await supabase.auth.admin.updateUserById(oldProfile.id, {
    email: newEmail,
    email_confirm: true,
  });
  if (updateError || updated.user.email?.trim().toLowerCase() !== newEmail) {
    return json({ error: 'Supabase Auth could not update the account email' }, 500);
  }
  const { error: auditError } = await supabase.from('audit_events').insert({
    program_id: programId,
    actor_user_id: actor.id,
    action: 'subscriber_access_email.updated',
    entity_type: 'profiles',
    entity_id: oldProfile.id,
    old_data: { email: oldEmail },
    new_data: { email: newEmail },
    request_id: 'guarded-account-email-change',
  });
  if (auditError) return json({ error: 'Email changed, but the audit event could not be recorded' }, 500);

  return json({ ...result, changed: true });
});
