import { paymentPosition } from './money';
import type { AssessmentAdjustment, CarryForward, Enrollment, FinancialAssessment, Payment } from './types';

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
  // A balance brought forward from last year counts toward (or against) this year's premium.
  const carryInKobo = enrollment.carryIn?.netKobo ?? 0;
  const premium = paymentPosition(enrollment.totalKobo, premiumPaidKobo + carryInKobo);
  const assessmentPaidKobo = assessment ? verifiedPayments(related, assessment.id) : 0;
  const adjustmentKobo = adjustment?.adjustmentKobo ?? 0;
  // The reconciliation model sweeps the HMO premium variance into the assessment position.
  // Keep the two components separate so each uses its own transfer reference.
  const assessmentOwnNetKobo = assessment ? assessment.amountKobo + adjustmentKobo - assessmentPaidKobo : 0;
  const premiumVarianceKobo = assessment ? premium.underpaymentKobo - premium.overpaymentKobo : 0;
  const assessmentNetKobo = assessment ? assessmentOwnNetKobo + premiumVarianceKobo : 0;

  return {
    premiumPaidKobo,
    carryInKobo,
    premium,
    assessmentPaidKobo,
    adjustmentKobo,
    assessmentOwnNetKobo,
    // What the subscriber should transfer under the assessment reference right now. An HMO
    // overpayment already reconciled against the assessment reduces it; a shortfall never
    // raises it, because that belongs under the HMO premium reference.
    assessmentOwnDueKobo: Math.max(0, assessmentOwnNetKobo - (assessment ? premium.overpaymentKobo : 0)),
    premiumVarianceKobo,
    assessmentNetKobo,
    assessmentDueKobo: Math.max(0, assessmentNetKobo),
    assessmentOverpaymentKobo: Math.max(0, -assessmentNetKobo),
    futureCreditKobo: assessment && assessmentNetKobo <= 0 ? assessment.futureCreditKobo : 0,
    futureCreditPendingKobo: assessment && assessmentNetKobo > 0 ? assessment.futureCreditKobo : 0,
  };
}

/**
 * The balance this enrollment carries into the household's next-year enrollment, where it is
 * applied to the HMO premium automatically. Mirrors public.enrollment_carry_forward
 * (migration 202610220024); keep them identical.
 *
 * - Premium balance: verified HMO payments plus any carry-in, less the subscriber total.
 * - Assessment balance: verified assessment payments less the assigned one-time fee and
 *   adjustment, so a fully paid higher contribution carries its credit and an unpaid one owes
 *   only the one-time fee. A submitted enrollee never assigned the assessment owes the
 *   current one-time fee (`registrationFeeKobo`).
 * - Proration credit: the stored late-enrollment credit.
 * An HMO overpayment first covers an assessment balance owed. Only submitted or closed
 * enrollments in a carry-forward year carry anything.
 */
export function nextEnrollmentCarryForward(
  enrollment: Enrollment,
  payments: Payment[],
  registrationFeeKobo: number,
  assessment?: FinancialAssessment,
  adjustment?: AssessmentAdjustment,
  carryForwardEnabled = true,
): CarryForward | null {
  if (!carryForwardEnabled || !['submitted', 'closed'].includes(enrollment.status)) return null;
  const financial = enrollmentFinancialPosition(enrollment, payments, assessment, adjustment);
  let premiumBalanceKobo = financial.premium.differenceKobo;
  let assessmentBalanceKobo = assessment
    ? financial.assessmentPaidKobo - assessment.feePortionKobo - financial.adjustmentKobo
    : 0 - registrationFeeKobo;
  const overpaymentAppliedKobo = premiumBalanceKobo > 0 && assessmentBalanceKobo < 0 ? Math.min(premiumBalanceKobo, -assessmentBalanceKobo) : 0;
  premiumBalanceKobo -= overpaymentAppliedKobo;
  assessmentBalanceKobo += overpaymentAppliedKobo;
  const prorationCreditKobo = enrollment.proration?.creditKobo ?? 0;
  return {
    sourceYear: enrollment.year,
    creditYear: enrollment.year + 1,
    premiumBalanceKobo,
    assessmentBalanceKobo,
    prorationCreditKobo,
    overpaymentAppliedKobo,
    netKobo: premiumBalanceKobo + assessmentBalanceKobo + prorationCreditKobo,
  };
}

/** The one-time registration fee new enrollees pay: the active assessment's default fee. */
export function registrationFeeKobo(assessments: FinancialAssessment[]) {
  return assessments.find((item) => item.active)?.feePortionKobo ?? 0;
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
