import { describe, expect, it } from 'vitest';
import { householdValidationMessage, isEnrollmentEditable, paymentReadinessMessage } from './subscriberWorkflow';
import type { Enrollment, EnrollmentPeriod } from './types';

const period: EnrollmentPeriod = { id: 'period', year: 2026, status: 'open', startsAt: '2026-06-01T00:00:00Z', endsAt: '2026-08-31T23:59:59Z' };
const enrollment = { planId: 'plus', totalKobo: 100, status: 'submitted' } as Enrollment;

describe('subscriber workflow rules', () => {
  it('only permits edits inside an open enrollment window', () => {
    expect(isEnrollmentEditable(period, new Date('2026-08-20T00:00:00Z'))).toBe(true);
    expect(isEnrollmentEditable({ ...period, status: 'closed' }, new Date('2026-08-20T00:00:00Z'))).toBe(false);
    expect(isEnrollmentEditable(period, new Date('2026-09-01T00:00:00Z'))).toBe(false);
  });

  it('enforces category and family-size consistency', () => {
    expect(householdValidationMessage('individual', 1)).toContain('Remove all dependents');
    expect(householdValidationMessage('family', 0)).toContain('at least one');
    expect(householdValidationMessage('family', 6)).toContain('no more than 5');
    expect(householdValidationMessage('family', 2)).toBeNull();
  });

  it('requires a submitted, priced enrollment before payment', () => {
    expect(paymentReadinessMessage(enrollment)).toBeNull();
    expect(paymentReadinessMessage({ ...enrollment, planId: null, totalKobo: 0 })).toContain('Select a plan');
    expect(paymentReadinessMessage({ ...enrollment, status: 'draft' })).toContain('Submit complete');
  });
});
