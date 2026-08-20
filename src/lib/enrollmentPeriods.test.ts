import { describe, expect, it } from 'vitest';
import { defaultAdminPeriod } from './enrollmentPeriods';
import type { EnrollmentPeriod } from './types';

const period = (year: number, status: EnrollmentPeriod['status']): EnrollmentPeriod => ({
  id: `${year}-${status}`,
  year,
  status,
  startsAt: `${year}-06-01T00:00:00Z`,
  endsAt: `${year}-08-31T23:59:59Z`,
});

describe('admin enrollment period default', () => {
  it('prefers the open period over newer scheduled periods', () => {
    expect(defaultAdminPeriod([period(2027, 'scheduled'), period(2026, 'open')])?.year).toBe(2026);
  });

  it('uses the most recently closed period when none is open', () => {
    expect(defaultAdminPeriod([period(2027, 'scheduled'), period(2025, 'closed'), period(2026, 'closed')])?.year).toBe(2026);
  });
});
