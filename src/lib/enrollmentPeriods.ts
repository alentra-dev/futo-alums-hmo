import type { EnrollmentPeriod } from './types';

export function defaultAdminPeriod(periods: EnrollmentPeriod[]) {
  return [...periods].sort((left, right) => {
    const priority = (period: EnrollmentPeriod) => period.status === 'open' ? 0 : period.status === 'closed' ? 1 : 2;
    return priority(left) - priority(right) || right.year - left.year;
  })[0] ?? null;
}
