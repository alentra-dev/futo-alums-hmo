import { PGlite } from '@electric-sql/pglite';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { migratedDatabase, testId as id } from '../test/migrationDatabase';

// Replays every migration against an embedded PostgreSQL with synthetic Supabase auth and
// storage stubs. No production connection, credentials, or real records are used.
const ADMIN = id(901);
const APPLICANT = id(902);
const OTHER = id(903);
let db: PGlite;

const as = async (user: string | null) => {
  await db.exec(`select set_config('test.uid','${user ?? ''}',true); set local role ${user ? 'authenticated' : 'anon'}`);
};
const asOwner = () => db.exec('reset role');
const one = async <T,>(sql: string) => (await db.query<T>(sql)).rows[0];

const person = (overrides: Record<string, string> = {}) => JSON.stringify({
  id: id(950), memberType: 'Member', surname: 'Synthetic', firstName: 'Late', middleName: '', dateOfBirth: '1975-05-05',
  gender: 'Female', relation: 'SELF', nationality: 'Nigerian', enrollmentDate: '2026-10-10', address: '1 Test Road',
  country: 'Nigeria', state: 'Rivers', town: 'Port Harcourt', lga: 'Obio/Akpor', mobile: '08000000001', email: 'late@example.com', ...overrides,
});

beforeAll(async () => {
  db = await migratedDatabase();
  await db.exec(`
    insert into auth.users(id,email) values('${ADMIN}','admin@example.com'),('${APPLICANT}','late@example.com'),('${OTHER}','other@example.com');
    insert into public.program_memberships(program_id,user_id,role) select id,'${ADMIN}','admin' from public.programs;
    insert into public.payment_accounts(program_id,beneficiary,bank,account_number,reference_prefix)
      select id,'Synthetic Custodian','Synthetic Bank','0000000000','FUTO HMO' from public.programs;
    insert into public.financial_assessments(program_id,period_id,name,amount_kobo,fee_portion_kobo,future_credit_kobo,credit_year,due_at,reference_prefix)
      select ep.program_id,ep.id,'CAC registration',1500000,1500000,0,2027,now(),'FUTO CAC' from public.enrollment_periods ep where ep.coverage_year=2026;
    -- The other subscriber already has a household in the program.
    insert into public.households(id,program_id) select '${id(960)}',id from public.programs;
    insert into public.account_households(user_id,household_id) values('${OTHER}','${id(960)}');
    insert into public.program_memberships(program_id,user_id) select id,'${OTHER}' from public.programs;
  `);
}, 60_000);
beforeEach(async () => { await db.exec('begin'); });
afterEach(async () => { await db.exec('rollback'); });
afterAll(async () => { await db?.close(); });

const period2026 = `(select id from public.enrollment_periods where coverage_year=2026)`;
const plusPlan = `(select id from public.plan_offerings where period_id=${period2026} and code='PLUS')`;
// Late enrollment: the renewal window has passed and the term began last month.
const closeWindow = (coverageStart = `(date_trunc('month', now() at time zone 'Africa/Lagos') - interval '1 month')::date`) => db.exec(`
  update public.enrollment_periods set starts_at=now()-interval '120 days', ends_at=now()-interval '1 day', status='closed',
    coverage_starts_on=${coverageStart} where id=${period2026};`);
const openWindow = () => db.exec(`
  update public.enrollment_periods set starts_at=now()-interval '10 days', ends_at=now()+interval '10 days', status='open',
    coverage_starts_on=(date_trunc('month', now() at time zone 'Africa/Lagos') + interval '2 months')::date where id=${period2026};`);

async function lateEnrollment(coverage: string) {
  await db.exec(`
    insert into public.enrollments(id,household_id,period_id,plan_offering_id,category,status,premium_kobo)
    values('${id(970)}','${id(960)}',${period2026},${plusPlan},'family','submitted',26408300);
    update public.enrollments set avon_coverage_start='${coverage}' where id='${id(970)}';`);
}

async function submitApplication() {
  const plan = await one<{ id: string }>(`select ${plusPlan} as id`);
  await as(APPLICANT);
  const created = await one<{ id: string }>('select public.create_subscriber_application() as id');
  await db.query(`select public.save_subscriber_application($1,$2::jsonb,true)`, [created.id, JSON.stringify({
    graduationYear: 1996, principal: JSON.parse(person()), dependents: [JSON.parse(person({ id: id(951), memberType: 'Dependent', firstName: 'Child', relation: 'SON', dateOfBirth: '2012-01-01', mobile: '', email: '' }))],
    planId: plan.id, category: 'family', hospital: 'Synthetic Hospital', consented: true,
  })]);
  await asOwner();
  return created.id;
}

describe('AVON proration of a late enrollment', () => {
  it('reproduces the AVON supplementary invoice for October coverage', async () => {
    await db.exec(`update public.enrollment_periods set coverage_starts_on='2026-09-01' where id=${period2026}`);
    await lateEnrollment('2026-10-17');
    const row = await one(`select avon_coverage_start::text as start, avon_billed_months as months, avon_prorated_premium_kobo as premium,
      avon_prorated_nhis_kobo as nhis, proration_credit_kobo as credit, nhis_fee_kobo as full_nhis, subscriber_total_kobo as total
      from public.enrollments where id='${id(970)}'`);
    // ₦242,076.08 + ₦2,420.76 = ₦244,496.84 billed; ₦266,723.83 collected for premium and NHIS.
    expect(row).toEqual({ start: '2026-10-01', months: 11, premium: 24207608, nhis: 242076, credit: 2222699, full_nhis: 264083, total: 27200549 });
  });

  it('bills the full term with no credit from the first coverage month', async () => {
    await db.exec(`update public.enrollment_periods set coverage_starts_on='2026-09-01' where id=${period2026}`);
    await lateEnrollment('2026-09-01');
    expect(await one(`select avon_billed_months as months, proration_credit_kobo as credit from public.enrollments where id='${id(970)}'`)).toEqual({ months: 12, credit: 0 });
  });

  it.each(['2026-08-01', '2027-09-01'])('rejects a coverage start of %s outside Sep 2026 – Aug 2027', async (start) => {
    await db.exec(`update public.enrollment_periods set coverage_starts_on='2026-09-01' where id=${period2026}`);
    await expect(lateEnrollment(start)).rejects.toThrow(/between Sep 2026 and Aug 2027/);
  });

  it('keeps the stored proration consistent when surcharge rates change', async () => {
    await db.exec(`update public.enrollment_periods set coverage_starts_on='2026-09-01' where id=${period2026}`);
    await lateEnrollment('2026-10-01');
    await as(ADMIN);
    await db.exec(`select public.update_enrollment_surcharge_rates(${period2026},200,200)`);
    await asOwner();
    const row = await one(`select avon_prorated_nhis_kobo as nhis, proration_credit_kobo as credit from public.enrollments where id='${id(970)}'`);
    expect(row).toEqual({ nhis: 484152, credit: 26408300 + 528166 - 24207608 - 484152 });
  });

  it('refuses a coverage-term change that would exclude a stored late start', async () => {
    await db.exec(`update public.enrollment_periods set coverage_starts_on='2026-09-01' where id=${period2026}`);
    await lateEnrollment('2026-10-01');
    await as(ADMIN);
    await expect(db.exec(`select public.update_enrollment_period(jsonb_build_object('id',${period2026},'coverageStartsOn','2026-11-01'))`)).rejects.toThrow(/AVON coverage must start/);
  });
});

describe('continuous new-subscriber intake', () => {
  it('uses the renewal window while it is open', async () => {
    await openWindow();
    const config = await one<{ c: { acceptingApplications: boolean; enrollmentMode: string; period: { status: string; lateCoverageStartsOn: string | null } } }>('select public.get_public_join_config() as c');
    expect(config.c).toMatchObject({ acceptingApplications: true, enrollmentMode: 'regular', period: { status: 'open', lateCoverageStartsOn: null } });
  });

  it('keeps accepting applications after the window closes, as late enrollment', async () => {
    await closeWindow();
    await as(null);
    const config = await one<{ c: { acceptingApplications: boolean; enrollmentMode: string; plans: unknown[]; newEnrolleeAssessment: { feePortionKobo: number; futureCreditKobo: number }; period: { status: string; lateCoverageStartsOn: string } } }>('select public.get_public_join_config() as c');
    const month = await one<{ m: string }>(`select date_trunc('month', now() at time zone 'Africa/Lagos')::date::text as m`);
    expect(config.c).toMatchObject({ acceptingApplications: true, enrollmentMode: 'late', period: { status: 'closed', lateCoverageStartsOn: month.m }, newEnrolleeAssessment: { feePortionKobo: 1500000, futureCreditKobo: 0 } });
    expect(config.c.plans.length).toBeGreaterThan(0);
  });

  it.each([
    ['late enrollment is switched off', `update public.enrollment_periods set late_enrollment_open=false where id=${period2026}`],
    ['the AVON term has ended', `update public.enrollment_periods set coverage_starts_on=(date_trunc('month', now()) - interval '12 months')::date where id=${period2026}`],
  ])('stops accepting applications when %s', async (_label, change) => {
    await closeWindow();
    await db.exec(change);
    const config = await one<{ c: { acceptingApplications: boolean; period: unknown; plans: unknown[] } }>('select public.get_public_join_config() as c');
    expect(config.c).toMatchObject({ acceptingApplications: false, period: null, plans: [] });
    await as(APPLICANT);
    await expect(db.exec('select public.create_subscriber_application()')).rejects.toThrow(/not accepting/);
  });

  it('approves a late applicant with the approval month, stored credit, and new-enrollee CAC terms', async () => {
    await closeWindow();
    const applicationId = await submitApplication();
    await as(ADMIN);
    const applications = await one<{ a: { lateCoverageStartsOn: string; premiumKobo: number; nhisFeeBasisPoints: number }[] }>('select public.get_admin_subscriber_applications() as a');
    expect(applications.a[0]).toMatchObject({ premiumKobo: 26408300, nhisFeeBasisPoints: 100 });
    expect(applications.a[0].lateCoverageStartsOn).toMatch(/^\d{4}-\d{2}-01$/);
    await db.exec(`select public.review_subscriber_application('${applicationId}','approve',null)`);
    await asOwner();
    const enrollment = await one(`select e.avon_billed_months as months, e.avon_prorated_premium_kobo as premium, e.proration_credit_kobo as credit,
      ea.amount_kobo as cac, ea.fee_portion_kobo as fee, ea.future_credit_kobo as cac_credit
      from public.subscriber_applications a join public.enrollments e on e.id=a.enrollment_id
      join public.enrollment_assessments ea on ea.enrollment_id=e.id where a.id='${applicationId}'`);
    expect(enrollment).toEqual({ months: 11, premium: 24207608, credit: 2222699, cac: 1500000, fee: 1500000, cac_credit: 0 });
  });

  it('assigns CAC terms but records no proration for an approval inside the window', async () => {
    await openWindow();
    const applicationId = await submitApplication();
    await as(ADMIN);
    await db.exec(`select public.review_subscriber_application('${applicationId}','approve',null)`);
    await asOwner();
    const enrollment = await one(`select e.avon_coverage_start as start, e.proration_credit_kobo as credit, ea.amount_kobo as cac
      from public.subscriber_applications a join public.enrollments e on e.id=a.enrollment_id
      join public.enrollment_assessments ea on ea.enrollment_id=e.id where a.id='${applicationId}'`);
    expect(enrollment).toEqual({ start: null, credit: null, cac: 1500000 });
  });
});

describe('coverage start administration and reads', () => {
  const setStart = (start: string | null, note = 'Matches the AVON supplementary invoice') =>
    db.exec(`select public.set_enrollment_coverage_start('${id(970)}',${start ? `'${start}'` : 'null'},'${note}')`);

  beforeEach(async () => {
    await db.exec(`update public.enrollment_periods set coverage_starts_on='2026-09-01' where id=${period2026}`);
    await lateEnrollment('2026-11-01');
  });

  it('lets an administrator correct the start month with an audited reason', async () => {
    await as(ADMIN);
    await setStart('2026-10-01');
    await asOwner();
    expect(await one(`select avon_billed_months as months, avon_coverage_note as note from public.enrollments where id='${id(970)}'`))
      .toEqual({ months: 11, note: 'Matches the AVON supplementary invoice' });
    const audit = await one<{ n: number }>(`select count(*)::int as n from public.audit_events where entity_type='enrollments' and actor_user_id='${ADMIN}' and new_data->>'avon_coverage_start'='2026-10-01'`);
    expect(audit.n).toBe(1);
  });

  it('clears the proration when an administrator restores full-term coverage', async () => {
    await as(ADMIN);
    await setStart(null, 'Joined within the renewal window');
    await asOwner();
    expect(await one(`select avon_billed_months as months, proration_credit_kobo as credit from public.enrollments where id='${id(970)}'`)).toEqual({ months: null, credit: null });
  });

  it('requires a reason', async () => {
    await as(ADMIN);
    await expect(setStart('2026-10-01', '')).rejects.toThrow(/Explain why/);
  });

  it.each([[OTHER, /Administrator access/], [null, /permission denied/]])('refuses %s', async (user, error) => {
    await as(user);
    await expect(setStart('2026-10-01')).rejects.toThrow(error);
  });

  it('shows stored prorations only to the household and administrators, without the admin note', async () => {
    await as(OTHER);
    const own = await one<{ c: { enrollments: { creditKobo: number; note: string | null; billedMonths: number }[]; coverageStartsOn: string } }>(`select public.get_enrollment_coverage(${period2026}) as c`);
    expect(own.c.coverageStartsOn).toBe('2026-09-01');
    expect(own.c.enrollments).toHaveLength(1);
    expect(own.c.enrollments[0]).toMatchObject({ billedMonths: 10, note: null });
    await asOwner();
    await db.exec(`insert into auth.users(id,email) values('${id(904)}','unrelated@example.com');
      insert into public.households(id,program_id) select '${id(961)}',id from public.programs;
      insert into public.account_households(user_id,household_id) values('${id(904)}','${id(961)}');
      insert into public.program_memberships(program_id,user_id) select id,'${id(904)}' from public.programs;`);
    await as(id(904));
    const unrelated = await one<{ c: { enrollments: unknown[] } }>(`select public.get_enrollment_coverage(${period2026}) as c`);
    expect(unrelated.c.enrollments).toEqual([]);
    await as(ADMIN);
    await setStart('2026-10-01');
    const admin = await one<{ c: { enrollments: { note: string | null }[] } }>(`select public.get_enrollment_coverage(${period2026}) as c`);
    expect(admin.c.enrollments[0].note).toBe('Matches the AVON supplementary invoice');
    await as(OTHER);
    const after = await one<{ c: { enrollments: { note: string | null }[] } }>(`select public.get_enrollment_coverage(${period2026}) as c`);
    expect(after.c.enrollments[0].note).toBeNull();
  });
});
