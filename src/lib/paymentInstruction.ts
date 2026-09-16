import type { FinancialAssessment, PaymentAccount } from './types';

/**
 * One program bank account collects every payment. HMO premiums and program assessments
 * differ only by the transfer reference the subscriber puts on the transfer, and that
 * reference is what reconciliation uses to tell the two apart.
 *
 * Migration 202609160021 removed the duplicate beneficiary/bank/account number columns
 * from `financial_assessments`, so an assessment can no longer name a different
 * destination and hand a subscriber a stale account number.
 */
export function paymentInstruction(
  programAccount: PaymentAccount,
  assessment?: Pick<FinancialAssessment, 'referencePrefix'> | null,
): PaymentAccount {
  if (!assessment) return programAccount;
  return { ...programAccount, referencePrefix: assessment.referencePrefix };
}
