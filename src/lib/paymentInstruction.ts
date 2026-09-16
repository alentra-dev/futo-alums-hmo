import type { FinancialAssessment, PaymentAccount } from './types';

/**
 * One program bank account collects every payment. HMO premiums and program assessments
 * differ only by the transfer reference the subscriber puts on the transfer, and that
 * reference is what reconciliation uses to tell the two apart.
 *
 * `financial_assessments` still stores its own beneficiary/bank/account number columns.
 * Those are a second copy of the same account and must never be shown as an alternative
 * destination, or a subscriber can be handed a stale account number after the program
 * account changes.
 */
export function paymentInstruction(
  programAccount: PaymentAccount,
  assessment?: Pick<FinancialAssessment, 'paymentAccount'> | null,
): PaymentAccount {
  if (!assessment) return programAccount;
  return { ...programAccount, referencePrefix: assessment.paymentAccount.referencePrefix };
}
