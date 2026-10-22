import { PGlite } from '@electric-sql/pglite';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { migratedDatabase, testId as id } from '../test/migrationDatabase';

// Synthetic households covering every carry-forward rule. Expected values are shared with the
// TypeScript mirror in proration.test.ts so both implementations stay identical.
const ADMIN = id(901);
const SUBSCRIBER = id(902);
const TOTAL = 27200549; // ₦264,083 premium + 1% NHIS + 2% program fee
const CAC = 3300000;
let db: PGlite;

const households = {
  paidAll: 11, unpaidCac: 12, overpaid: 13, underpaidPartial: 14, late: 15, unassigned: 16, draft: 17, imported: 18,
} as const;
type Household = keyof typeof households;
const enrollment = (household: Household, year = 2026) => id(households[household] * 10 + (year - 2020));

beforeAll(async () => {
  db = await migratedDatabase();
  const values = (rows: string[]) => rows.join(',');
  await db.exec(`
    insert into auth.users(id,email) values('${ADMIN}','admin@example.com'),('${SUBSCRIBER}','member@example.com');
    insert into public.program_memberships(program_id,user_id,role) select id,'${ADMIN}','admin' from public.programs;
    insert into public.program_memberships(program_id,user_id) select id,'${SUBSCRIBER}' from public.programs;
    insert into public.households(id,program_id) select h,p.id from public.programs p,
      unnest(array[${Object.values(households).map((n) => `'${id(n)}'::uuid`).join(',')}]) h;
    insert into public.account_households(user_id,household_id) values('${SUBSCRIBER}','${id(households.paidAll)}');
    update public.enrollment_periods set status='closed', coverage_starts_on='2026-09-01' where coverage_year=2026;
    insert into public.financial_assessments(id,program_id,period_id,name,amount_kobo,fee_portion_kobo,future_credit_kobo,credit_year,due_at,reference_prefix)
      select '${id(500)}',program_id,id,'CAC registration',1500000,1500000,0,2027,now(),'FUTO CAC' from public.enrollment_periods where coverage_year=2026;
  `);
  const period = `(select id from public.enrollment_periods where coverage_year=2026)`;
  const plan = `(select id from public.plan_offerings where period_id=${period} and code='PLUS')`;
  const add = (household: Household, status = 'closed', coverage = 'null') =>
    `('${enrollment(household)}','${id(households[household])}',${period},${plan},'family','${status}',26408300,${coverage})`;
  await db.exec(`
    insert into public.enrollments(id,household_id,period_id,plan_offering_id,category,status,premium_kobo,avon_coverage_start) values
      ${values([add('paidAll'), add('unpaidCac'), add('overpaid'), add('underpaidPartial'), add('late', 'submitted', `'2026-10-01'`), add('unassigned'), add('draft', 'draft')])};
    -- Earlier enrollees keep the original ₦33,000 = ₦15,000 fee + ₦18,000 credit terms.
    insert into public.enrollment_assessments(assessment_id,enrollment_id,program_id,amount_kobo,fee_portion_kobo,future_credit_kobo,credit_year)
      select '${id(500)}',e,program_id,${CAC},1500000,1800000,2027 from public.financial_assessments,
      unnest(array['${enrollment('paidAll')}','${enrollment('unpaidCac')}','${enrollment('overpaid')}','${enrollment('underpaidPartial')}','${enrollment('draft')}']::uuid[]) e;
    insert into public.enrollment_assessments(assessment_id,enrollment_id,program_id) select '${id(500)}','${enrollment('late')}',program_id from public.financial_assessments;
    insert into public.payments(enrollment_id,amount_kobo,paid_at,reference,status,assessment_id) values
      ('${enrollment('paidAll')}',${TOTAL},'2026-08-01','HMO','verified',null),
      ('${enrollment('paidAll')}',${CAC},'2026-08-01','CAC','verified','${id(500)}'),
      ('${enrollment('unpaidCac')}',${TOTAL},'2026-08-01','HMO','verified',null),
      ('${enrollment('overpaid')}',${TOTAL + 500000},'2026-08-01','HMO','verified',null),
      ('${enrollment('overpaid')}',${CAC},'2026-08-01','CAC','verified','${id(500)}'),
      ('${enrollment('underpaidPartial')}',${TOTAL - 1000000},'2026-08-01','HMO','verified',null),
      ('${enrollment('underpaidPartial')}',1000000,'2026-08-01','CAC','verified','${id(500)}'),
      ('${enrollment('underpaidPartial')}',2000000,'2026-08-02','CAC','pending','${id(500)}'),
      ('${enrollment('late')}',${TOTAL + 1500000},'2026-10-10','HMO','verified',null),
      ('${enrollment('unassigned')}',${TOTAL},'2026-08-01','HMO','verified',null),
      ('${enrollment('draft')}',100000,'2026-08-01','HMO','rejected',null);
    -- An imported 2025 record with a variance must never reach 2026.
    insert into public.enrollments(id,household_id,period_id,category,status,premium_kobo)
      select '${enrollment('imported', 2025)}','${id(households.imported)}',id,'individual','closed',5000000 from public.enrollment_periods where coverage_year=2025;
    insert into public.enrollments(id,household_id,period_id,plan_offering_id,category,status,premium_kobo)
      select '${enrollment('imported')}','${id(households.imported)}',${period},${plan},'family','closed',26408300;
  `);
  // The annual rollover creates the 2027 drafts that receive the carry-forward.
  await db.exec(`select set_config('test.uid','${ADMIN}',false)`);
  await db.exec(`select public.create_next_enrollment_year(${period},2027,'2027-06-01T00:00:00+01','2027-08-31T23:59:59+01')`);
  await db.exec(`select set_config('test.uid','',false)`);
}, 60_000);
beforeEach(async () => { await db.exec('begin'); });
afterEach(async () => { await db.exec('rollback'); });
afterAll(async () => { await db?.close(); });

const period2027 = `(select id from public.enrollment_periods where coverage_year=2027)`;
async function carryIns(user = ADMIN) {
  await db.exec(`select set_config('test.uid','${user}',true); set local role authenticated`);
  const result = await db.query<{ c: { carryForwardEnabled: boolean; enrollments: { enrollmentId: string; carryIn: Record<string, number> }[] } }>(`select public.get_enrollment_carry_forwards(${period2027}) as c`);
  await db.exec('reset role');
  const ids = await db.query<{ id: string; household_id: string }>(`select id,household_id from public.enrollments where period_id=${period2027}`);
  const byHousehold = new Map(ids.rows.map((row) => [row.household_id, row.id]));
  return { enabled: result.rows[0].c.carryForwardEnabled, carry: (household: Household) => result.rows[0].c.enrollments.find((row) => row.enrollmentId === byHousehold.get(id(households[household])))?.carryIn ?? null, count: result.rows[0].c.enrollments.length };
}

describe('next-year carry-forward', () => {
  it('carries the ₦18,000 credit of a fully paid higher CAC contribution', async () => {
    expect((await carryIns()).carry('paidAll')).toMatchObject({ sourceYear: 2026, creditYear: 2027, premiumBalanceKobo: 0, assessmentBalanceKobo: 1800000, prorationCreditKobo: 0, netKobo: 1800000 });
  });

  it('charges only the ₦15,000 one-time fee when the higher CAC was never paid', async () => {
    expect((await carryIns()).carry('unpaidCac')).toMatchObject({ assessmentBalanceKobo: -1500000, netKobo: -1500000 });
  });

  it('adds an HMO overpayment to the credit', async () => {
    expect((await carryIns()).carry('overpaid')).toMatchObject({ premiumBalanceKobo: 500000, assessmentBalanceKobo: 1800000, netKobo: 2300000 });
  });

  it('carries an HMO shortfall and the unpaid part of the fee, ignoring pending payments', async () => {
    expect((await carryIns()).carry('underpaidPartial')).toMatchObject({ premiumBalanceKobo: -1000000, assessmentBalanceKobo: -500000, netKobo: -1500000 });
  });

  it('applies a late member’s single combined transfer to the fee and carries the proration credit', async () => {
    expect((await carryIns()).carry('late')).toMatchObject({ premiumBalanceKobo: 0, assessmentBalanceKobo: 0, overpaymentAppliedKobo: 1500000, prorationCreditKobo: 2222699, netKobo: 2222699 });
  });

  it('charges the default one-time fee to a submitted enrollee never assigned the assessment', async () => {
    expect((await carryIns()).carry('unassigned')).toMatchObject({ premiumBalanceKobo: 0, assessmentBalanceKobo: -1500000, netKobo: -1500000 });
  });

  it('carries nothing from drafts or from imported 2025 records', async () => {
    const { carry, count } = await carryIns();
    expect(carry('draft')).toBeNull();
    expect(carry('imported')).toMatchObject({ premiumBalanceKobo: -TOTAL });
    expect(count).toBe(7);
    await db.exec(`update public.enrollment_periods set carry_forward_enabled=false where coverage_year=2026`);
    expect((await carryIns()).count).toBe(0);
    const imported2026 = await db.query<{ c: unknown }>(`select public.enrollment_carry_in('${enrollment('imported')}') as c`);
    expect(imported2026.rows[0].c).toBeNull();
  });

  it('updates live when a prior-year payment is verified late', async () => {
    await db.exec(`update public.payments set status='verified' where enrollment_id='${enrollment('underpaidPartial')}' and status='pending'`);
    expect((await carryIns()).carry('underpaidPartial')).toMatchObject({ premiumBalanceKobo: -1000000, assessmentBalanceKobo: 1500000, netKobo: 500000 });
  });

  it('chains the carry-in into the next year’s own carry-forward', async () => {
    const target = (await db.query<{ id: string }>(`select id from public.enrollments where period_id=${period2027} and household_id='${id(households.paidAll)}'`)).rows[0].id;
    const plan = `(select id from public.plan_offerings where period_id=${period2027} and code='PLUS')`;
    await db.exec(`update public.enrollments set plan_offering_id=${plan},premium_kobo=26408300,status='submitted' where id='${target}';
      insert into public.payments(enrollment_id,amount_kobo,paid_at,reference,status) values('${target}',${TOTAL - 1800000},'2027-07-01','HMO','verified');`);
    const result = await db.query<{ c: { premiumBalanceKobo: number; assessmentBalanceKobo: number; netKobo: number } }>(`select public.enrollment_carry_forward('${target}') as c`);
    // The 2026 credit settles the 2027 premium exactly; 2027 has no assessment configured.
    expect(result.rows[0].c).toMatchObject({ premiumBalanceKobo: 0, assessmentBalanceKobo: 0, netKobo: 0 });
  });

  it('shows a subscriber only their own household’s carry-forward', async () => {
    const { count, carry } = await carryIns(SUBSCRIBER);
    expect(count).toBe(1);
    expect(carry('paidAll')).toMatchObject({ netKobo: 1800000 });
  });

  it('keeps the calculation function private', async () => {
    await db.exec(`set local role authenticated`);
    await expect(db.exec(`select public.enrollment_carry_forward('${enrollment('paidAll')}')`)).rejects.toThrow(/permission denied/);
  });

  it('refuses anonymous reads', async () => {
    await db.exec(`set local role anon`);
    await expect(db.exec(`select public.get_enrollment_carry_forwards(${period2027})`)).rejects.toThrow(/permission denied/);
  });
});
