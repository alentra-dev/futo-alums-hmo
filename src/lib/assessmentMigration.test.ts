import { readFileSync } from 'node:fs';
import { PGlite } from '@electric-sql/pglite';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';

// Synthetic PostgreSQL fixture for the new migration. Existing auth helpers are represented
// by two unrelated households; no production connection or credentials are used.
const id = (n: number) => `00000000-0000-0000-0000-${String(n).padStart(12, '0')}`;
let db: PGlite;
const terms = (amount = 1500000, fee = 1500000, credit = 0, year = 2027, note = 'Fee-only exception') =>
  `select public.set_enrollment_assessment_terms('${id(5)}','${id(8)}',${amount},${fee},${credit},${year},0,'${note}')`;

beforeAll(async () => {
  db = new PGlite();
  await db.exec(`
    create role anon; create role authenticated;
    create table public.enrollment_periods(id uuid primary key, program_id uuid, coverage_year integer);
    create table public.enrollments(id uuid primary key, period_id uuid references public.enrollment_periods, household_id uuid, status text);
    create table public.financial_assessments(id uuid primary key, program_id uuid, period_id uuid references public.enrollment_periods,
      name text, description text, amount_kobo bigint, fee_portion_kobo bigint, future_credit_kobo bigint, credit_year integer,
      due_at timestamptz, active boolean, reference_prefix text, created_at timestamptz default now());
    create table public.enrollment_assessments(assessment_id uuid references public.financial_assessments,
      enrollment_id uuid references public.enrollments, program_id uuid, adjustment_kobo bigint not null default 0,
      note text not null default '', updated_at timestamptz default now(), primary key(assessment_id,enrollment_id));
    alter table public.enrollment_assessments enable row level security;
    create table public.payments(id uuid, enrollment_id uuid, assessment_id uuid, amount_kobo bigint, status text);
    create table public.audit_fixture(action text, new_data jsonb);
    create function public.audit_fixture_change() returns trigger language plpgsql as $$ begin
      insert into public.audit_fixture values(tg_op,to_jsonb(new)); return new; end $$;
    create trigger audit_existing_assignment after insert or update on public.enrollment_assessments
      for each row execute function public.audit_fixture_change();
    create function public.is_program_admin(uuid) returns boolean language sql as $$
      select $1='${id(1)}'::uuid and current_setting('test.actor',true)='admin' $$;
    create function public.is_program_member(uuid) returns boolean language sql as $$
      select $1='${id(1)}'::uuid and current_setting('test.actor',true) in ('admin','subscriber1','subscriber2') $$;
    create function public.can_access_household(uuid) returns boolean language sql as $$
      select current_setting('test.actor',true)='admin'
        or ($1='${id(11)}'::uuid and current_setting('test.actor',true)='subscriber1')
        or ($1='${id(12)}'::uuid and current_setting('test.actor',true)='subscriber2') $$;
    insert into public.enrollment_periods values('${id(3)}','${id(1)}',2026),('${id(4)}','${id(2)}',2026),('${id(14)}','${id(1)}',2025);
    insert into public.enrollments values('${id(7)}','${id(3)}','${id(11)}','closed'),('${id(8)}','${id(3)}','${id(12)}','submitted'),('${id(9)}','${id(4)}','${id(13)}','submitted'),('${id(15)}','${id(14)}','${id(11)}','closed');
    insert into public.financial_assessments values('${id(5)}','${id(1)}','${id(3)}','Synthetic assessment','Synthetic disclosure',3300000,1500000,1800000,2027,now(),true,'ASSESSMENT',now()),
      ('${id(6)}','${id(2)}','${id(4)}','Other program','',3300000,1500000,1800000,2027,now(),true,'OTHER',now()),
      ('${id(16)}','${id(1)}','${id(14)}','Historical','',3300000,1500000,1800000,2027,now(),true,'HISTORY',now());
    insert into public.enrollment_assessments(assessment_id,enrollment_id,program_id) values('${id(5)}','${id(7)}','${id(1)}'),('${id(16)}','${id(15)}','${id(1)}');
    insert into public.payments values('${id(20)}','${id(7)}','${id(5)}',3300000,'verified');
  `);
  // Execute top-level statements separately, as the deployment runner does. Sending the
  // entire file in one query would hide a missing transaction around LOCK TABLE.
  const migration = readFileSync('supabase/migrations/202610100022_individual_assessment_terms.sql', 'utf8').replace(/--[^\n]*/g, '');
  const statements = migration.match(/(?:\$\$[\s\S]*?\$\$|'(?:[^']|'')*'|[^;])+;/g) ?? [];
  for (const statement of statements) await db.exec(statement);
}, 30_000);
beforeEach(async () => { await db.exec("begin; select set_config('test.actor','admin',true);"); });
afterEach(async () => { await db.exec('rollback'); });
afterAll(async () => { await db?.close(); });

describe('individual assessment migration in PostgreSQL', () => {
  it('backfills earlier terms, preserves them after default edits, and snapshots new legacy assignments', async () => {
    await db.exec(`update public.financial_assessments set amount_kobo=1500000,future_credit_kobo=0 where id='${id(5)}';`);
    const old = await db.query(`select amount_kobo,future_credit_kobo from public.enrollment_assessments where enrollment_id='${id(7)}'`);
    expect(old.rows[0]).toEqual({ amount_kobo: 3300000, future_credit_kobo: 1800000 });
    await db.exec(`insert into public.enrollment_assessments(assessment_id,enrollment_id,program_id) values('${id(5)}','${id(8)}','${id(1)}')`);
    const latest = await db.query(`select amount_kobo,future_credit_kobo from public.enrollment_assessments where enrollment_id='${id(8)}'`);
    expect(latest.rows[0]).toEqual({ amount_kobo: 1500000, future_credit_kobo: 0 });
  });

  it('saves an audited fee-only exception without changing the earlier assignment or payments', async () => {
    await db.exec('set local role authenticated');
    await db.exec(terms());
    await db.exec('reset role');
    const result = await db.query(`select amount_kobo,fee_portion_kobo,future_credit_kobo from public.enrollment_assessments where enrollment_id='${id(8)}'`);
    expect(result.rows[0]).toEqual({ amount_kobo: 1500000, fee_portion_kobo: 1500000, future_credit_kobo: 0 });
    const audit = await db.query(`select new_data->>'future_credit_kobo' as credit from public.audit_fixture where new_data->>'enrollment_id'='${id(8)}'`);
    expect(audit.rows[0]).toEqual({ credit: '0' });
    const earlier = await db.query(`select amount_kobo from public.enrollment_assessments where enrollment_id='${id(7)}'`);
    expect(earlier.rows[0]).toEqual({ amount_kobo: 3300000 });
    expect((await db.query('select amount_kobo from public.payments')).rows).toEqual([{ amount_kobo: 3300000 }]);
  });

  it('updates existing individual terms through the same audited RPC', async () => {
    await db.exec(terms());
    await db.exec(terms(2000000,1500000,500000,2028,'Revised approved terms'));
    const result = await db.query(`select amount_kobo,future_credit_kobo,credit_year from public.enrollment_assessments where enrollment_id='${id(8)}'`);
    expect(result.rows[0]).toEqual({ amount_kobo: 2000000, future_credit_kobo: 500000, credit_year: 2028 });
  });

  it.each([
    ['negative fee', () => terms(1500000,-1,1500001)],
    ['mismatched split', () => terms(1500000,1500000,100)],
    ['past credit year', () => terms(1500000,1500000,0,2026)],
    ['missing reason', () => terms(1500000,1500000,0,2027,'')],
    ['missing financial term', () => terms().replace('1500000,1500000,0,2027','null,1500000,0,2027')],
    ['negative adjusted payable', () => terms().replace('2027,0,','2027,-1500001,')],
  ])('rejects %s', async (_label, statement) => { await expect(db.exec(statement())).rejects.toThrow(); });

  it('rejects subscriber writes even to their own enrollment', async () => {
    await db.exec("select set_config('test.actor','subscriber2',true); set local role authenticated");
    await expect(db.exec(terms())).rejects.toThrow(/Administrator access/);
  });

  it('revokes anonymous RPC execution', async () => {
    await db.exec('set local role anon');
    await expect(db.exec(terms())).rejects.toThrow(/permission denied/);
  });

  it.each([9,15])('rejects cross-program or cross-period enrollment %s', async enrollment => {
    await expect(db.exec(terms().replace(id(8),id(enrollment)))).rejects.toThrow(/Administrator access/);
  });

  it.each(['subscriber1','subscriber2'])('isolates workspace reads for %s and the selected year', async actor => {
    await db.exec(terms());
    await db.exec(`select set_config('test.actor','${actor}',true); set local role authenticated`);
    const result = await db.query<{ workspace: { assessmentAdjustments: { enrollmentId: string; futureCreditKobo: number }[]; paymentLinks: unknown[] } }>(`select public.get_financial_workspace('${id(3)}') as workspace`);
    const adjustments = result.rows[0].workspace.assessmentAdjustments;
    expect(adjustments).toHaveLength(1);
    expect(adjustments[0].enrollmentId).toBe(actor === 'subscriber1' ? id(7) : id(8));
    expect(adjustments[0].futureCreditKobo).toBe(actor === 'subscriber1' ? 1800000 : 0);
    expect(result.rows[0].workspace.paymentLinks).toHaveLength(actor === 'subscriber1' ? 1 : 0);
  });
});
