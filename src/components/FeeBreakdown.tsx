import clsx from 'clsx';
import { calculateFees, formatNaira } from '../lib/money';

export function FeeBreakdown({ premiumKobo, compact = false }: { premiumKobo: number; compact?: boolean }) {
  const fees = calculateFees(premiumKobo);
  return <dl className={clsx('fee-breakdown', compact && 'fee-breakdown--compact')}>
    <div><dt>AVON premium</dt><dd>{formatNaira(fees.premiumKobo)}</dd></div>
    <div><dt>Program fee (3%)</dt><dd>{formatNaira(fees.programFeeKobo)}</dd></div>
    <div className="fee-breakdown__tax"><dt>Banking transaction tax (15%)<small>Applied to premium plus program fee</small></dt><dd>{formatNaira(fees.transactionTaxFeeKobo)}</dd></div>
    <div className="fee-breakdown__total"><dt>Total payable</dt><dd>{formatNaira(fees.subscriberTotalKobo)}</dd></div>
  </dl>;
}
