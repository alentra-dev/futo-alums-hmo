import { programDateValue } from './format';
import type { EnrollmentPeriod, EnrollmentProration } from './types';

/**
 * AVON coverage for enrollment year N runs twelve months from 1 September N through
 * 31 August N+1. A member who joins after the renewal window still pays the full annual
 * subscriber total; AVON bills the program only for the months from their coverage start
 * month to the end of the term. The difference between the full premium + NHIS collected
 * and AVON's prorated premium + NHIS is credited toward the member's next enrollment. The
 * program administrative fee is charged on the full premium and is not part of the credit.
 *
 * Migration 202610220023 stores the same calculation on each enrollment; keep them identical.
 */
export const COVERAGE_TERM_MONTHS = 12;

export const defaultCoverageStart = (year: number) => `${year}-09-01`;

const monthIndex = (month: string) => {
  const [year, value] = month.split('-').map(Number);
  return year * 12 + value - 1;
};
const monthFromIndex = (index: number) => `${Math.floor(index / 12)}-${String((index % 12) + 1).padStart(2, '0')}-01`;

export const firstOfMonth = (value: string) => `${value.slice(0, 7)}-01`;

export function coverageTermStart(period: Pick<EnrollmentPeriod, 'year' | 'coverageStartsOn'>) {
  return period.coverageStartsOn ?? defaultCoverageStart(period.year);
}

/** The last covered month of the term, e.g. 2027-08-01 for a term starting 2026-09-01. */
export function coverageTermEnd(termStart: string) {
  return monthFromIndex(monthIndex(termStart) + COVERAGE_TERM_MONTHS - 1);
}

export function formatCoverageMonth(month: string) {
  const [year, value] = month.split('-').map(Number);
  return new Intl.DateTimeFormat('en-GB', { month: 'short', year: 'numeric', timeZone: 'UTC' }).format(new Date(Date.UTC(year, value - 1, 1)));
}

export function coverageRange(start: string, termStart: string) {
  return `${formatCoverageMonth(start)} – ${formatCoverageMonth(coverageTermEnd(termStart))}`;
}

/** Billed months, or null when the start month falls outside the coverage term. */
export function billedMonths(termStart: string, coverageStart: string) {
  const months = COVERAGE_TERM_MONTHS - (monthIndex(coverageStart) - monthIndex(termStart));
  return months >= 1 && months <= COVERAGE_TERM_MONTHS ? months : null;
}

export function avonProration(
  premiumKobo: number,
  nhisFeeBasisPoints: number,
  termStart: string,
  coverageStart: string,
  creditYear: number,
): EnrollmentProration | null {
  const months = billedMonths(termStart, coverageStart);
  if (months === null) return null;
  const fullNhisKobo = Math.round((premiumKobo * nhisFeeBasisPoints) / 10_000);
  const proratedPremiumKobo = Math.round((premiumKobo * months) / COVERAGE_TERM_MONTHS);
  const proratedNhisKobo = Math.round((proratedPremiumKobo * nhisFeeBasisPoints) / 10_000);
  return {
    coverageStartMonth: firstOfMonth(coverageStart),
    billedMonths: months,
    proratedPremiumKobo,
    proratedNhisKobo,
    creditKobo: premiumKobo + fullNhisKobo - proratedPremiumKobo - proratedNhisKobo,
    creditYear,
  };
}

/** The coverage month an approval made now would record. */
export function lateCoverageStart(period: Pick<EnrollmentPeriod, 'year' | 'coverageStartsOn'>, timezone: string, now = new Date()) {
  const termStart = coverageTermStart(period);
  const current = firstOfMonth(programDateValue(timezone, now));
  return monthIndex(current) > monthIndex(termStart) ? current : termStart;
}

/** True once the renewal window has passed, whether by date or by an administrator closing it. */
export function afterRenewalWindow(period: Pick<EnrollmentPeriod, 'status' | 'endsAt'>, now = new Date()) {
  return period.status !== 'scheduled' && (period.status === 'closed' || now.getTime() > new Date(period.endsAt).getTime());
}

/**
 * Mirrors public.application_intake for one period: 'regular' within the renewal window,
 * 'late' after it while the AVON term is running and late enrollment is enabled.
 */
export function intakeMode(period: EnrollmentPeriod, timezone: string, now = new Date()): 'regular' | 'late' | null {
  const time = now.getTime();
  if (period.status === 'open' && time >= new Date(period.startsAt).getTime() && time <= new Date(period.endsAt).getTime()) return 'regular';
  if (period.lateEnrollmentOpen === false || !afterRenewalWindow(period, now) || time < new Date(period.startsAt).getTime()) return null;
  const today = firstOfMonth(programDateValue(timezone, now));
  return monthIndex(today) <= monthIndex(coverageTermEnd(coverageTermStart(period))) ? 'late' : null;
}
