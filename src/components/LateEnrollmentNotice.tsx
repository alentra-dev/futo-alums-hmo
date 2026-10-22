import { CalendarClock } from 'lucide-react';
import { formatNaira } from '../lib/money';
import { coverageRange } from '../lib/proration';
import type { EnrollmentProration } from '../lib/types';

/** Subscriber-facing explanation of a late enrollment and its next-year credit. */
export function LateEnrollmentNotice({ proration, termStart }: { proration: EnrollmentProration; termStart: string }) {
  return <div className="info-banner late-enrollment-note" role="note"><CalendarClock size={18} /><span>
    <strong>Late enrollment · AVON coverage {coverageRange(proration.coverageStartMonth, termStart)} ({proration.billedMonths} months)</strong>
    You joined after the renewal window, so AVON bills the program only for these months while you pay the full annual total.
    {' '}The {formatNaira(proration.creditKobo)} difference is credited to your {proration.creditYear} enrollment automatically.
  </span></div>;
}
