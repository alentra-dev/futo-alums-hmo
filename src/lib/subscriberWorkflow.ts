import type { Enrollment, EnrollmentPeriod, PlanCategory } from './types';

export const MAX_FAMILY_DEPENDENTS = 5;

export function isEnrollmentEditable(period: EnrollmentPeriod, now = new Date()) {
  const current = now.getTime();
  return period.status === 'open'
    && current >= new Date(period.startsAt).getTime()
    && current <= new Date(period.endsAt).getTime();
}

export function householdValidationMessage(category: PlanCategory, dependentCount: number) {
  if (category === 'individual' && dependentCount > 0) return 'Remove all dependents before changing to individual coverage.';
  if (category === 'family' && dependentCount === 0) return 'Add at least one dependent for family coverage.';
  if (dependentCount > MAX_FAMILY_DEPENDENTS) return `Family coverage supports no more than ${MAX_FAMILY_DEPENDENTS} dependents.`;
  return null;
}

export function paymentReadinessMessage(enrollment: Enrollment) {
  if (!enrollment.planId || enrollment.totalKobo <= 0) return 'Select a plan before notifying a payment.';
  if (enrollment.status !== 'submitted' && enrollment.status !== 'closed') return 'Submit complete enrollment details before notifying a payment.';
  return null;
}
