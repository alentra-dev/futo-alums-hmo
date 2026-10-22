import { describe, expect, it } from 'vitest';
import { demoSnapshot } from '../data/demo';
import { enrollmentFinancialPosition, nextEnrollmentCarryForward } from './financialPosition';
import { calculateFees, nairaToKobo } from './money';
import { afterRenewalWindow, avonProration, billedMonths, coverageRange, coverageTermEnd, intakeMode, lateCoverageStart } from './proration';
import type { Enrollment, EnrollmentPeriod, Payment } from './types';

const PLUS_FAMILY = nairaToKobo(264_083);
const period: EnrollmentPeriod = {
  id: 'period-2026', year: 2026, startsAt: '2026-05-31T23:00:00Z', endsAt: '2026-09-05T22:59:00Z', status: 'closed',
  nhisFeeBasisPoints: 100, programFeeBasisPoints: 200, coverageStartsOn: '2026-09-01', lateEnrollmentOpen: true,
};

describe('AVON proration', () => {
  it('matches the AVON supplementary invoice for Plus family cover from October 2026', () => {
    const proration = avonProration(PLUS_FAMILY, 100, '2026-09-01', '2026-10-01', 2027)!;
    expect(proration).toEqual({
      coverageStartMonth: '2026-10-01', billedMonths: 11,
      proratedPremiumKobo: nairaToKobo(242_076.08), proratedNhisKobo: nairaToKobo(2_420.76),
      creditKobo: nairaToKobo(22_226.99), creditYear: 2027,
    });
    // Billed total ₦244,496.84; collected premium + NHIS ₦266,723.83.
    expect(proration.proratedPremiumKobo + proration.proratedNhisKobo).toBe(nairaToKobo(244_496.84));
  });

  it('keeps the program administrative fee on the full premium, outside the credit', () => {
    const fees = calculateFees(PLUS_FAMILY);
    const proration = avonProration(PLUS_FAMILY, 100, '2026-09-01', '2026-10-01', 2027)!;
    expect(fees.subscriberTotalKobo).toBe(nairaToKobo(272_005.49));
    expect(fees.reserveFeeKobo).toBe(nairaToKobo(5_281.66));
    expect(fees.subscriberTotalKobo - fees.reserveFeeKobo - proration.creditKobo).toBe(proration.proratedPremiumKobo + proration.proratedNhisKobo);
  });

  it('runs the term September through August and bills from the start month', () => {
    expect(coverageTermEnd('2026-09-01')).toBe('2027-08-01');
    expect(coverageRange('2026-10-01', '2026-09-01')).toBe('Oct 2026 – Aug 2027');
    expect(billedMonths('2026-09-01', '2026-09-01')).toBe(12);
    expect(billedMonths('2026-09-01', '2027-08-01')).toBe(1);
    expect(billedMonths('2026-09-01', '2026-08-01')).toBeNull();
    expect(billedMonths('2026-09-01', '2027-09-01')).toBeNull();
    expect(avonProration(PLUS_FAMILY, 100, '2026-09-01', '2026-09-01', 2027)?.creditKobo).toBe(0);
  });

  it('uses the approval month in the program time zone, never before the term starts', () => {
    // 23:30 UTC on 31 October is already 1 November in Lagos.
    expect(lateCoverageStart(period, 'Africa/Lagos', new Date('2026-10-31T23:30:00Z'))).toBe('2026-11-01');
    expect(lateCoverageStart(period, 'Africa/Lagos', new Date('2026-07-15T12:00:00Z'))).toBe('2026-09-01');
  });
});

describe('continuous intake', () => {
  const at = (iso: string) => new Date(iso);
  it('is regular inside the renewal window and late after it until the term ends', () => {
    const open = { ...period, status: 'open' as const };
    expect(intakeMode(open, 'Africa/Lagos', at('2026-07-01T12:00:00Z'))).toBe('regular');
    expect(intakeMode(open, 'Africa/Lagos', at('2026-10-22T12:00:00Z'))).toBe('late');
    expect(intakeMode(period, 'Africa/Lagos', at('2027-08-31T12:00:00Z'))).toBe('late');
    expect(intakeMode(period, 'Africa/Lagos', at('2027-09-01T12:00:00Z'))).toBeNull();
    expect(intakeMode({ ...period, lateEnrollmentOpen: false }, 'Africa/Lagos', at('2026-10-22T12:00:00Z'))).toBeNull();
    expect(intakeMode({ ...period, status: 'scheduled' }, 'Africa/Lagos', at('2026-10-22T12:00:00Z'))).toBeNull();
  });

  it('treats an administrator closing the period early as after the window', () => {
    expect(afterRenewalWindow({ ...period, endsAt: '2026-12-31T00:00:00Z' }, at('2026-10-22T12:00:00Z'))).toBe(true);
    expect(afterRenewalWindow({ ...period, status: 'open', endsAt: '2026-12-31T00:00:00Z' }, at('2026-10-22T12:00:00Z'))).toBe(false);
  });
});

describe('next-enrollment carry-forward (same cases as carryForwardMigration.test.ts)', () => {
  const TOTAL = calculateFees(PLUS_FAMILY).subscriberTotalKobo;
  const assessment = { ...demoSnapshot.assessments[0], amountKobo: nairaToKobo(15_000), feePortionKobo: nairaToKobo(15_000), futureCreditKobo: 0, creditYear: 2027 };
  const member = (overrides: Partial<Enrollment> = {}): Enrollment => ({ ...demoSnapshot.enrollments[0], id: 'member', year: 2026, status: 'closed', totalKobo: TOTAL, proration: null, carryIn: null, ...overrides });
  const terms = (amountKobo: number, futureCreditKobo: number) => ({ assessmentId: assessment.id, enrollmentId: 'member', adjustmentKobo: 0, note: '', amountKobo, feePortionKobo: nairaToKobo(15_000), futureCreditKobo, creditYear: 2027 });
  const higher = terms(nairaToKobo(33_000), nairaToKobo(18_000));
  const pay = (amountKobo: number, assessmentId: string | null = null, status: Payment['status'] = 'verified'): Payment => ({ ...demoSnapshot.payments[0], id: `${assessmentId}-${amountKobo}-${status}`, enrollmentId: 'member', amountKobo, status, assessmentId });
  const carry = (enrollment: Enrollment, payments: Payment[], assignment?: ReturnType<typeof terms>) =>
    nextEnrollmentCarryForward(enrollment, payments, nairaToKobo(15_000), assignment ? { ...assessment, ...assignment, id: assessment.id } : undefined, assignment);

  it('carries the ₦18,000 credit of a fully paid higher CAC contribution', () => {
    expect(carry(member(), [pay(TOTAL), pay(nairaToKobo(33_000), assessment.id)], higher)).toMatchObject({ creditYear: 2027, premiumBalanceKobo: 0, assessmentBalanceKobo: 1_800_000, netKobo: 1_800_000 });
  });

  it('charges only the ₦15,000 one-time fee when the higher CAC was never paid', () => {
    expect(carry(member(), [pay(TOTAL)], higher)).toMatchObject({ assessmentBalanceKobo: -1_500_000, netKobo: -1_500_000 });
  });

  it('adds an HMO overpayment to the credit', () => {
    expect(carry(member(), [pay(TOTAL + 500_000), pay(nairaToKobo(33_000), assessment.id)], higher)).toMatchObject({ premiumBalanceKobo: 500_000, netKobo: 2_300_000 });
  });

  it('carries an HMO shortfall and the unpaid part of the fee, ignoring pending payments', () => {
    expect(carry(member(), [pay(TOTAL - 1_000_000), pay(1_000_000, assessment.id), pay(2_000_000, assessment.id, 'pending')], higher))
      .toMatchObject({ premiumBalanceKobo: -1_000_000, assessmentBalanceKobo: -500_000, netKobo: -1_500_000 });
  });

  it('applies a late member’s single combined transfer to the fee and carries the proration credit', () => {
    const late = member({ status: 'submitted', proration: avonProration(PLUS_FAMILY, 100, '2026-09-01', '2026-10-01', 2027) });
    const payments = [pay(TOTAL + 1_500_000)];
    expect(carry(late, payments, terms(nairaToKobo(15_000), 0))).toMatchObject({ premiumBalanceKobo: 0, assessmentBalanceKobo: 0, overpaymentAppliedKobo: 1_500_000, prorationCreditKobo: 2_222_699, netKobo: 2_222_699 });
    // Nothing more is requested under the assessment reference this year.
    expect(enrollmentFinancialPosition(late, payments, { ...assessment }, terms(nairaToKobo(15_000), 0)).assessmentOwnDueKobo).toBe(0);
  });

  it('charges the default one-time fee to a submitted enrollee never assigned the assessment', () => {
    expect(carry(member(), [pay(TOTAL)])).toMatchObject({ premiumBalanceKobo: 0, assessmentBalanceKobo: -1_500_000, netKobo: -1_500_000 });
  });

  it('carries nothing from drafts or from years without carry-forward', () => {
    expect(carry(member({ status: 'draft' }), [pay(TOTAL)], higher)).toBeNull();
    expect(nextEnrollmentCarryForward(member(), [pay(TOTAL)], nairaToKobo(15_000), undefined, undefined, false)).toBeNull();
  });

  it('applies a carry-in to this year’s premium and chains it into the next carry-forward', () => {
    const carryIn = { sourceYear: 2026, creditYear: 2027, premiumBalanceKobo: 0, assessmentBalanceKobo: 1_800_000, prorationCreditKobo: 0, overpaymentAppliedKobo: 0, netKobo: 1_800_000 };
    const next = member({ year: 2027, carryIn });
    const payments = [pay(TOTAL - 1_800_000)];
    expect(enrollmentFinancialPosition(next, payments).premium).toMatchObject({ status: 'paid in full', differenceKobo: 0 });
    expect(nextEnrollmentCarryForward(next, payments, 0)).toMatchObject({ creditYear: 2028, premiumBalanceKobo: 0, assessmentBalanceKobo: 0, netKobo: 0 });
  });
});
