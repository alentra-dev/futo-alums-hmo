import clsx from 'clsx';
import { calculateFees, formatBasisPoints, formatNaira, type SurchargeRates } from '../lib/money';

export function FeeBreakdown({ premiumKobo, rates, compact = false }: { premiumKobo: number; rates: SurchargeRates; compact?: boolean }) {
  const fees = calculateFees(premiumKobo, rates);
  return <dl className={clsx('fee-breakdown', compact && 'fee-breakdown--compact')}>
    <div><dt>AVON premium</dt><dd>{formatNaira(fees.premiumKobo)}</dd></div>
    <div><dt>AVON NHIS fee ({formatBasisPoints(rates.nhisFeeBasisPoints)}%)</dt><dd>{formatNaira(fees.nhisFeeKobo)}</dd></div>
    <div><dt>Program fee ({formatBasisPoints(rates.programFeeBasisPoints)}%)</dt><dd>{formatNaira(fees.reserveFeeKobo)}</dd></div>
    <div className="fee-breakdown__tax"><dt>Banking transaction tax ({formatBasisPoints(rates.transactionTaxBasisPoints)}%)<small>Applied after AVON NHIS and program fees</small></dt><dd>{formatNaira(fees.transactionTaxFeeKobo)}</dd></div>
    <div className="fee-breakdown__total"><dt>Total payable</dt><dd>{formatNaira(fees.subscriberTotalKobo)}</dd></div>
  </dl>;
}
