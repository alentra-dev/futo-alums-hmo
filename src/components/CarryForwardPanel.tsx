import { ArrowRightLeft, Info } from 'lucide-react';
import { formatNaira, formatSignedNaira } from '../lib/money';
import type { CarryForward, FinancialAssessment } from '../lib/types';

/** The lines that make up a carry-forward, shared by the next-year and brought-forward views. */
export function CarryForwardLines({ carry, assessmentName = 'CAC registration contribution' }: { carry: CarryForward; assessmentName?: string }) {
  return <>
    {carry.prorationCreditKobo > 0 && <div><dt>Late-enrollment credit (months AVON did not bill)</dt><dd>{formatSignedNaira(carry.prorationCreditKobo)}</dd></div>}
    {carry.premiumBalanceKobo > 0 && <div><dt>HMO premium overpayment</dt><dd>{formatSignedNaira(carry.premiumBalanceKobo)}</dd></div>}
    {carry.premiumBalanceKobo < 0 && <div><dt>HMO premium still unpaid</dt><dd>{formatSignedNaira(carry.premiumBalanceKobo)}</dd></div>}
    {carry.assessmentBalanceKobo > 0 && <div><dt>{assessmentName} credit</dt><dd>{formatSignedNaira(carry.assessmentBalanceKobo)}</dd></div>}
    {carry.assessmentBalanceKobo < 0 && <div><dt>One-time CAC registration fee</dt><dd>{formatSignedNaira(carry.assessmentBalanceKobo)}</dd></div>}
    {carry.overpaymentAppliedKobo > 0 && carry.assessmentBalanceKobo === 0 && <div><dt>{assessmentName} (paid with your HMO transfer)</dt><dd>Settled</dd></div>}
  </>;
}

/**
 * What this year's records will carry into the next enrollment, applied automatically. A
 * member with an unpaid higher contribution is told that only the one-time fee will be charged.
 */
export function CarryForwardPanel({ carry, assessment, assessmentOwnDueKobo, assessmentPaidKobo }: {
  carry: CarryForward;
  /** The member's assigned terms, if any. */
  assessment?: FinancialAssessment;
  assessmentOwnDueKobo: number;
  assessmentPaidKobo: number;
}) {
  const heading = carry.netKobo > 0
    ? `${formatNaira(carry.netKobo)} credit toward ${carry.creditYear}`
    : carry.netKobo < 0 ? `${formatNaira(-carry.netKobo)} carried into ${carry.creditYear} unless paid` : `Nothing carried into ${carry.creditYear}`;
  const unpaidHigherContribution = assessment && assessment.futureCreditKobo > 0 && assessmentOwnDueKobo > 0;
  const owedFee = -Math.min(0, carry.assessmentBalanceKobo);
  return <section className="panel carry-forward-panel" aria-label={`Your ${carry.creditYear} enrollment`}>
    <div className="panel__heading"><div><p className="eyebrow">Your {carry.creditYear} enrollment</p><h2>{heading}</h2></div><ArrowRightLeft size={21} /></div>
    <dl className="fee-breakdown fee-breakdown--compact">
      <CarryForwardLines carry={carry} assessmentName={assessment?.name} />
      <div className="fee-breakdown__total"><dt>{carry.netKobo >= 0 ? 'Credit applied to' : 'Added to'} your {carry.creditYear} enrollment</dt><dd>{formatNaira(Math.abs(carry.netKobo))}</dd></div>
    </dl>
    {unpaidHigherContribution && <p className="pending-note carry-forward-panel__cac"><Info size={16} /><span>
      {assessmentPaidKobo === 0
        ? <>Your {formatNaira(assessment.amountKobo)} {assessment.name} is unpaid. If it stays unpaid, only the one-time <b>{formatNaira(assessment.feePortionKobo)} CAC registration fee</b> is charged with your {carry.creditYear} enrollment, and the {formatNaira(assessment.futureCreditKobo)} credit is not earned. Paying {formatNaira(assessmentOwnDueKobo)} now earns that credit instead.</>
        : <>{owedFee > 0 ? <>{formatNaira(owedFee)} of the one-time CAC registration fee is still unpaid and will be charged with your {carry.creditYear} enrollment. </> : null}Paying the remaining {formatNaira(assessmentOwnDueKobo)} now raises your {carry.creditYear} credit to include the full {formatNaira(assessment.futureCreditKobo)}.</>}
    </span></p>}
    <small className="carry-forward-panel__footnote">Applied automatically to your {carry.creditYear} enrollment. Based on payments verified so far; confirmations awaiting review are not included{carry.premiumBalanceKobo < 0 ? ', and any premium you pay now reduces the amount carried' : ''}.</small>
  </section>;
}

/** The balance brought forward from last year, shown against this year's payable. */
export function BroughtForwardBreakdown({ carry, totalKobo }: { carry: CarryForward; totalKobo: number }) {
  return <dl className="fee-breakdown fee-breakdown--compact brought-forward">
    <div><dt><b>Brought forward from {carry.sourceYear}</b></dt><dd>{formatSignedNaira(carry.netKobo)}</dd></div>
    <CarryForwardLines carry={carry} />
    <div className="fee-breakdown__total"><dt>Payable after {carry.sourceYear} balance</dt><dd>{formatNaira(Math.max(0, totalKobo - carry.netKobo))}</dd></div>
  </dl>;
}
