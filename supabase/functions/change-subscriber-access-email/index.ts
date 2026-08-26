import { createClient } from 'npm:@supabase/supabase-js@2';

const PORTAL_URL = 'https://alentra-dev.github.io/futo-alums-hmo/';
const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const ALLOWED_ORIGINS = new Set([new URL(PORTAL_URL).origin, 'http://localhost:5173']);

function responseHeaders(request: Request) {
  const origin = request.headers.get('origin') ?? '';
  return {
    'content-type': 'application/json',
    'access-control-allow-origin': ALLOWED_ORIGINS.has(origin) ? origin : new URL(PORTAL_URL).origin,
    'access-control-allow-headers': 'authorization, x-client-info, apikey, content-type',
    'access-control-allow-methods': 'POST, OPTIONS',
    vary: 'Origin',
  };
}

function json(request: Request, body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: responseHeaders(request) });
}

Deno.serve(async (request) => {
  if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers: responseHeaders(request) });
  if (request.method !== 'POST') return json(request, { error: 'Method not allowed' }, 405);

  const authorization = request.headers.get('authorization');
  if (!authorization) return json(request, { error: 'Authentication required' }, 401);
  const url = Deno.env.get('SUPABASE_URL')!;
  const anonKey = Deno.env.get('SUPABASE_ANON_KEY')!;
  const callerClient = createClient(url, anonKey, {
    global: { headers: { Authorization: authorization } },
    auth: { persistSession: false },
  });
  const { data: caller, error: callerError } = await callerClient.auth.getUser();
  if (callerError || !caller.user) return json(request, { error: 'Authentication required' }, 401);

  const body = await request.json().catch(() => ({}));
  const userId = String(body.userId ?? '').trim();
  const currentEmail = String(body.currentEmail ?? '').trim().toLowerCase();
  const newEmail = String(body.newEmail ?? '').trim().toLowerCase();
  const sendLoginLink = body.sendLoginLink !== false;
  if (!UUID_PATTERN.test(userId) || !EMAIL_PATTERN.test(currentEmail) || !EMAIL_PATTERN.test(newEmail) || currentEmail === newEmail) {
    return json(request, { error: 'Select an account and enter a different valid email address' }, 400);
  }

  const service = createClient(url, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!, { auth: { persistSession: false } });
  const { data: actorMembership, error: actorError } = await service.from('program_memberships').select('program_id,role').eq('user_id', caller.user.id).eq('active', true).in('role', ['admin', 'owner']).limit(1).maybeSingle();
  if (actorError || !actorMembership) return json(request, { error: 'Administrator access required' }, 403);

  const { data: targetProfile, error: targetError } = await service.from('profiles').select('id,email,display_name').eq('id', userId).maybeSingle();
  if (targetError || !targetProfile || targetProfile.email.trim().toLowerCase() !== currentEmail) {
    return json(request, { error: 'The subscriber account changed. Refresh the list and try again.' }, 409);
  }
  const { data: targetMembership, error: targetMembershipError } = await service.from('program_memberships').select('role').eq('program_id', actorMembership.program_id).eq('user_id', userId).eq('active', true).maybeSingle();
  if (targetMembershipError || targetMembership?.role !== 'subscriber') {
    return json(request, { error: 'Only subscriber-role account emails can be changed here' }, 403);
  }
  const { count: householdCount, error: householdError } = await service.from('account_households').select('household_id,households!inner(program_id)', { count: 'exact', head: true }).eq('user_id', userId).eq('households.program_id', actorMembership.program_id);
  if (householdError || !householdCount) return json(request, { error: 'The account is not linked to a subscriber household' }, 409);

  const { data: duplicate, error: duplicateError } = await service.from('profiles').select('id').ilike('email', newEmail).maybeSingle();
  if (duplicateError) return json(request, { error: 'Unable to validate the replacement email' }, 500);
  if (duplicate && duplicate.id !== userId) return json(request, { error: 'That email already belongs to another portal account' }, 409);
  const { data: authUser, error: authError } = await service.auth.admin.getUserById(userId);
  if (authError || authUser.user?.email?.trim().toLowerCase() !== currentEmail) {
    return json(request, { error: 'The Auth identity does not match the subscriber profile' }, 409);
  }

  const { data: updated, error: updateError } = await service.auth.admin.updateUserById(userId, { email: newEmail, email_confirm: true });
  if (updateError || updated.user.email?.trim().toLowerCase() !== newEmail) {
    return json(request, { error: 'Supabase Auth could not update the account email' }, 500);
  }
  const { error: auditError } = await service.from('audit_events').insert({
    program_id: actorMembership.program_id,
    actor_user_id: caller.user.id,
    action: `subscriber.access_email_updated:${targetProfile.display_name}`,
    entity_type: 'profiles',
    entity_id: userId,
    old_data: { email: currentEmail },
    new_data: { email: newEmail },
    request_id: request.headers.get('x-request-id'),
  });
  if (auditError) return json(request, { error: 'Email changed, but the audit event could not be recorded', changed: true }, 500);

  let loginLinkSent = false;
  let loginLinkWarning: string | null = null;
  if (sendLoginLink) {
    const delivery = createClient(url, anonKey, { auth: { persistSession: false } });
    const { error: linkError } = await delivery.auth.signInWithOtp({ email: newEmail, options: { emailRedirectTo: PORTAL_URL, shouldCreateUser: false } });
    loginLinkSent = !linkError;
    if (linkError) loginLinkWarning = 'The email changed, but the sign-in link could not be sent. The subscriber can request one from the portal.';
  }
  return json(request, { changed: true, householdCount, historicalEnrollmentDataChanged: false, loginLinkSent, loginLinkWarning });
});
