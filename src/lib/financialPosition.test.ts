import { describe, expect, it } from 'vitest';
import { demoSnapshot } from '../data/demo';
import { assessmentForEnrollment, enrollmentFinancialPosition } from './financialPosition';
import { nairaToKobo, paymentPosition } from './money';

describe('subscriber financial position', () => {
  it('preserves exact underpayment and overpayment values', () => {
    expect(paymentPosition(27_200_549, 27_200_500)).toMatchObject({ status: 'underpaid', underpaymentKobo: 49, overpaymentKobo: 0 });
    expect(paymentPosition(9_761_104, 10_000_000)).toMatchObject({ status: 'overpaid', underpaymentKobo: 0, overpaymentKobo: 238_896 });
  });

  it('uses the premium variance to calculate the separate assessment net due', () => {
    const enrollment = demoSnapshot.enrollments[0];
    const assigned = assessmentForEnrollment(enrollment.id, demoSnapshot.assessments, demoSnapshot.assessmentAdjustments);
    const financial = enrollmentFinancialPosition(enrollment, demoSnapshot.payments, assigned.assessment, assigned.adjustment);
    expect(financial.premiumPaidKobo).toBe(nairaToKobo(200_000));
    expect(financial.assessmentDueKobo).toBe(nairaToKobo(33_000) + financial.premium.underpaymentKobo);
    expect(financial.futureCreditKobo).toBe(0);
    expect(financial.futureCreditPendingKobo).toBe(nairaToKobo(18_000));
  });

  it('separates the assessment contribution from the swept HMO premium variance', () => {
    const enrollment = demoSnapshot.enrollments[0];
    const assigned = assessmentForEnrollment(enrollment.id, demoSnapshot.assessments, demoSnapshot.assessmentAdjustments);
    const financial = enrollmentFinancialPosition(enrollment, demoSnapshot.payments, assigned.assessment, assigned.adjustment);
    // The subscriber must only be asked to transfer the assessment's own balance into the
    // assessment account; the premium shortfall belongs in the HMO account.
    expect(financial.assessmentOwnDueKobo).toBe(nairaToKobo(33_000));
    expect(financial.premiumVarianceKobo).toBe(financial.premium.underpaymentKobo);
    expect(financial.assessmentOwnNetKobo + financial.premiumVarianceKobo).toBe(financial.assessmentNetKobo);
  });

  it('reports no assessment balance once the contribution itself is settled', () => {
    const enrollment = demoSnapshot.enrollments[0];
    const assessment = demoSnapshot.assessments[0];
    const payments = [{ ...demoSnapshot.payments[0], id: 'assessment-payment', amountKobo: assessment.amountKobo, status: 'verified' as const, assessmentId: assessment.id }];
    const financial = enrollmentFinancialPosition(enrollment, payments, assessment, demoSnapshot.assessmentAdjustments[0]);
    expect(financial.assessmentOwnDueKobo).toBe(0);
    // The combined reconciliation position still carries the unpaid premium.
    expect(financial.assessmentDueKobo).toBe(enrollment.totalKobo);
  });

  it('nets an overpaid premium against the assessment without going below zero', () => {
    const enrollment = demoSnapshot.enrollments[0];
    const assessment = demoSnapshot.assessments[0];
    const payments = [{ ...demoSnapshot.payments[0], amountKobo: enrollment.totalKobo + nairaToKobo(50_000), status: 'verified' as const, assessmentId: null }];
    const financial = enrollmentFinancialPosition(enrollment, payments, assessment, demoSnapshot.assessmentAdjustments[0]);
    expect(financial.premiumVarianceKobo).toBe(-nairaToKobo(50_000));
    expect(financial.assessmentDueKobo).toBe(0);
    expect(financial.assessmentOverpaymentKobo).toBe(nairaToKobo(17_000));
    // The assessment contribution itself is still unpaid and still owed to its own account.
    expect(financial.assessmentOwnDueKobo).toBe(nairaToKobo(33_000));
  });

  it('does not count assessment payments as HMO premium payments', () => {
    const enrollment = demoSnapshot.enrollments[0];
    const assessment = demoSnapshot.assessments[0];
    const payments = [{ ...demoSnapshot.payments[0], amountKobo: enrollment.totalKobo, assessmentId: null }, { ...demoSnapshot.payments[0], id: 'assessment-payment', amountKobo: assessment.amountKobo, assessmentId: assessment.id }];
    const financial = enrollmentFinancialPosition(enrollment, payments, assessment, demoSnapshot.assessmentAdjustments[0]);
    expect(financial.premium.status).toBe('paid in full');
    expect(financial.assessmentPaidKobo).toBe(assessment.amountKobo);
    expect(financial.futureCreditKobo).toBe(assessment.futureCreditKobo);
  });
});
