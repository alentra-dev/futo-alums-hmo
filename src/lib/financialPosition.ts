import { paymentPosition } from './money';
import type { AssessmentAdjustment, Enrollment, FinancialAssessment, Payment } from './types';

export function verifiedPayments(payments: Payment[], assessmentId: string | null = null) {
  return payments
    .filter((payment) => payment.status === 'verified' && payment.assessmentId === assessmentId)
    .reduce((sum, payment) => sum + payment.amountKobo, 0);
}

export function enrollmentFinancialPosition(
  enrollment: Enrollment,
  payments: Payment[],
  assessment?: FinancialAssessment,
  adjustment?: AssessmentAdjustment,
) {
  const related = payments.filter((payment) => payment.enrollmentId === enrollment.id);
  const premiumPaidKobo = verifiedPayments(related);
  const premium = paymentPosition(enrollment.totalKobo, premiumPaidKobo);
  const assessmentPaidKobo = assessment ? verifiedPayments(related, assessment.id) : 0;
  const adjustmentKobo = adjustment?.adjustmentKobo ?? 0;
  const assessmentNetKobo = assessment
    ? assessment.amountKobo + premium.underpaymentKobo - premium.overpaymentKobo + adjustmentKobo - assessmentPaidKobo
    : 0;

  return {
    premiumPaidKobo,
    premium,
    assessmentPaidKobo,
    adjustmentKobo,
    assessmentNetKobo,
    assessmentDueKobo: Math.max(0, assessmentNetKobo),
    assessmentOverpaymentKobo: Math.max(0, -assessmentNetKobo),
    futureCreditKobo: assessment && assessmentNetKobo <= 0 ? assessment.futureCreditKobo : 0,
    futureCreditPendingKobo: assessment && assessmentNetKobo > 0 ? assessment.futureCreditKobo : 0,
  };
}

export function assessmentForEnrollment(
  enrollmentId: string,
  assessments: FinancialAssessment[],
  adjustments: AssessmentAdjustment[],
) {
  const configured = assessments.find((item) => item.active);
  const adjustment = configured
    ? adjustments.find((item) => item.assessmentId === configured.id && item.enrollmentId === enrollmentId)
    : undefined;
  return {
    assessment: adjustment ? configured : undefined,
    adjustment,
  };
}
