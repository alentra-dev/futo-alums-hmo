import clsx from 'clsx';
import { formatBasisPoints, formatNaira } from '../lib/money';
import { coverageRange, COVERAGE_TERM_MONTHS } from '../lib/proration';
import type { EnrollmentProration } from '../lib/types';

/**
 * Late-enrollment disclosure: the member pays the full annual total, AVON bills the program
 * for the remaining months only, and the premium + NHIS difference becomes a credit.
 */
export function ProrationBreakdown({ proration, termStart, nhisFeeBasisPoints, estimate = false, compact = false }: {
  proration: EnrollmentProration;
  termStart: string;
  nhisFeeBasisPoints: number;
  /** Before approval the start month is only expected, not recorded. */
  estimate?: boolean;
  compact?: boolean;
}) {
  return <dl className={clsx('fee-breakdown proration-breakdown', compact && 'fee-breakdown--compact')}>
    <div><dt>AVON coverage{estimate ? ' (expected)' : ''}</dt><dd>{coverageRange(proration.coverageStartMonth, termStart)} · {proration.billedMonths} of {COVERAGE_TERM_MONTHS} months</dd></div>
    <div><dt>AVON prorated premium</dt><dd>{formatNaira(proration.proratedPremiumKobo)}</dd></div>
    <div><dt>AVON NHIS fee ({formatBasisPoints(nhisFeeBasisPoints)}%) on prorated premium</dt><dd>{formatNaira(proration.proratedNhisKobo)}</dd></div>
    <div className="fee-breakdown__total"><dt>{estimate ? 'Estimated credit' : 'Credit'} toward {proration.creditYear} enrollment</dt><dd>{formatNaira(proration.creditKobo)}</dd></div>
  </dl>;
}
