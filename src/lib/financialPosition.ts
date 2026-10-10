import { paymentPosition } from './money';
import type { AssessmentAdjustment, Enrollment, FinancialAssessment, Payment } from './types';

export function verifiedPayments(payments: Payment[], assessmentId: string | null = null) {
  return payments
    .filter((payment) => payment.status === 'verified' && payment.assessmentId === assessmentId)
    .reduce((sum, payment) => sum + payment.amountKobo, 0);
}

export function assignedAssessmentTerms(assessment: FinancialAssessment, assignment?: AssessmentAdjustment): FinancialAssessment {
  return {
    ...assessment,
    amountKobo: assignment?.amountKobo ?? assessment.amountKobo,
    feePortionKobo: assignment?.feePortionKobo ?? assessment.feePortionKobo,
    futureCreditKobo: assignment?.futureCreditKobo ?? assessment.futureCreditKobo,
    creditYear: assignment?.creditYear ?? assessment.creditYear,
  };
}

export function enrollmentFinancialPosition(
  enrollment: Enrollment,
  payments: Payment[],
  assessment?: FinancialAssessment,
  adjustment?: AssessmentAdjustment,
) {
  assessment = assessment ? assignedAssessmentTerms(assessment, adjustment) : undefined;
  const related = payments.filter((payment) => payment.enrollmentId === enrollment.id);
  const premiumPaidKobo = verifiedPayments(related);
  const premium = paymentPosition(enrollment.totalKobo, premiumPaidKobo);
  const assessmentPaidKobo = assessment ? verifiedPayments(related, assessment.id) : 0;
  const adjustmentKobo = adjustment?.adjustmentKobo ?? 0;
  // The reconciliation model sweeps the HMO premium variance into the assessment position.
  // Keep the two components separate so each uses its own transfer reference.
  const assessmentOwnNetKobo = assessment ? assessment.amountKobo + adjustmentKobo - assessmentPaidKobo : 0;
  const premiumVarianceKobo = assessment ? premium.underpaymentKobo - premium.overpaymentKobo : 0;
  const assessmentNetKobo = assessment ? assessmentOwnNetKobo + premiumVarianceKobo : 0;

  return {
    premiumPaidKobo,
    premium,
    assessmentPaidKobo,
    adjustmentKobo,
    assessmentOwnNetKobo,
    // What the subscriber should transfer to the assessment account right now.
    assessmentOwnDueKobo: Math.max(0, assessmentOwnNetKobo),
    premiumVarianceKobo,
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
    assessment: configured && adjustment ? assignedAssessmentTerms(configured, adjustment) : undefined,
    adjustment,
  };
}
