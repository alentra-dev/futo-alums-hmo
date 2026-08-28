import { createClient } from 'npm:@supabase/supabase-js@2';

const KEY_HASH = '3e50530bc2c93149d9700e678ebd4871873c29664da64d0d5843afdc6a9afa8a';
const PROGRAM_SLUG = 'futo-alums-hmo';
const COVERAGE_YEAR = 2026;
const CONFIRMATION = 'DELETE_ALL_2026_REFUNDED_PAYMENTS';

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
}

async function sha256(value: string) {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value));
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, '0')).join('');
}

function chunks<T>(items: T[], size: number) {
  return Array.from({ length: Math.ceil(items.length / size) }, (_, index) => items.slice(index * size, (index + 1) * size));
}

async function listProofPaths(client: ReturnType<typeof createClient>, enrollmentIds: string[]) {
  const paths: string[] = [];
  for (const enrollmentId of enrollmentIds) {
    let offset = 0;
    while (true) {
      const { data, error } = await client.storage.from('payment-proofs').list(enrollmentId, {
        limit: 100,
        offset,
        sortBy: { column: 'name', order: 'asc' },
      });
      if (error) throw error;
      const files = (data ?? []).filter((item) => item.id).map((item) => `${enrollmentId}/${item.name}`);
      paths.push(...files);
      if ((data ?? []).length < 100) break;
      offset += 100;
    }
  }
  return [...new Set(paths)];
}

async function loadScope(client: ReturnType<typeof createClient>) {
  const { data: program, error: programError } = await client.from('programs').select('id').eq('slug', PROGRAM_SLUG).single();
  if (programError) throw programError;
  const { data: period, error: periodError } = await client.from('enrollment_periods')
    .select('id,status').eq('program_id', program.id).eq('coverage_year', COVERAGE_YEAR).single();
  if (periodError) throw periodError;
  const { data: enrollments, error: enrollmentError } = await client.from('enrollments').select('id').eq('period_id', period.id);
  if (enrollmentError) throw enrollmentError;
  const enrollmentIds = (enrollments ?? []).map((item) => item.id);
  const { data: payments, error: paymentError } = await client.from('payments')
    .select('id,enrollment_id,amount_kobo,proof_path,status,enrollments!inner(period_id)')
    .eq('enrollments.period_id', period.id).order('created_at');
  if (paymentError) throw paymentError;
  const proofPaths = await listProofPaths(client, enrollmentIds);
  return { program, period, enrollmentIds, payments: payments ?? [], proofPaths };
}

function report(scope: Awaited<ReturnType<typeof loadScope>>) {
  const statusCounts = scope.payments.reduce<Record<string, number>>((counts, payment) => {
    counts[payment.status] = (counts[payment.status] ?? 0) + 1;
    return counts;
  }, {});
  return {
    coverageYear: COVERAGE_YEAR,
    periodStatus: scope.period.status,
    enrollmentCount: scope.enrollmentIds.length,
    paymentCount: scope.payments.length,
    proofFileCount: scope.proofPaths.length,
    totalAmountKobo: scope.payments.reduce((total, payment) => total + Number(payment.amount_kobo), 0),
    paymentsByStatus: statusCounts,
  };
}

async function removeProofs(client: ReturnType<typeof createClient>, paths: string[]) {
  for (const batch of chunks(paths, 100)) {
    const { error } = await client.storage.from('payment-proofs').remove(batch);
    if (error) throw error;
  }
}

async function removePayments(client: ReturnType<typeof createClient>, paymentIds: string[]) {
  for (const batch of chunks(paymentIds, 100)) {
    const { error } = await client.from('payments').delete().in('id', batch);
    if (error) throw error;
  }
}

Deno.serve(async (request) => {
  if (request.method !== 'POST') return json({ error: 'Method not allowed' }, 405);
  if (await sha256(request.headers.get('x-reset-key') ?? '') !== KEY_HASH) return json({ error: 'Unauthorized' }, 401);

  const body = await request.json().catch(() => ({}));
  const operation = body.operation;
  if (!['preview', 'execute'].includes(operation)) return json({ error: 'Operation must be preview or execute' }, 400);

  const client = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!, { auth: { persistSession: false } });
  try {
    const before = await loadScope(client);
    if (operation === 'preview') return json({ operation, before: report(before), confirmationRequired: CONFIRMATION });
    if (body.confirmation !== CONFIRMATION) return json({ error: 'Exact reset confirmation is required' }, 400);

    await removeProofs(client, before.proofPaths);
    await removePayments(client, before.payments.map((payment) => payment.id));

    // A second pass catches a payment uploaded during the first pass.
    const interim = await loadScope(client);
    await removeProofs(client, interim.proofPaths);
    await removePayments(client, interim.payments.map((payment) => payment.id));

    const after = await loadScope(client);
    if (after.payments.length || after.proofPaths.length) {
      return json({ error: 'Reset verification failed', before: report(before), after: report(after) }, 409);
    }

    const { data: ownerMembership, error: ownerError } = await client.from('program_memberships')
      .select('user_id').eq('program_id', before.program.id).eq('role', 'owner').eq('active', true).limit(1).single();
    if (ownerError) throw ownerError;
    const { error: auditError } = await client.from('audit_events').insert({
      program_id: before.program.id,
      actor_user_id: ownerMembership.user_id,
      action: 'Reset 2026 refunded payments',
      entity_type: 'maintenance',
      entity_id: before.period.id,
      old_data: report(before),
      new_data: report(after),
      request_id: crypto.randomUUID(),
    });
    if (auditError) throw auditError;

    return json({ operation, before: report(before), after: report(after), auditRecorded: true });
  } catch (error) {
    return json({ error: error instanceof Error ? error.message : 'Payment reset failed' }, 500);
  }
});
