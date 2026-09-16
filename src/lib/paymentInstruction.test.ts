import { describe, expect, it } from 'vitest';
import { demoSnapshot } from '../data/demo';
import { paymentInstruction } from './paymentInstruction';

describe('payment instructions', () => {
  const account = demoSnapshot.paymentAccount;
  const assessment = demoSnapshot.assessments[0];

  it('uses the single program account for premiums and assessments alike', () => {
    const premium = paymentInstruction(account);
    const programAssessment = paymentInstruction(account, assessment);
    expect(programAssessment.bank).toBe(premium.bank);
    expect(programAssessment.accountNumber).toBe(premium.accountNumber);
    expect(programAssessment.beneficiary).toBe(premium.beneficiary);
  });

  it('varies only the transfer reference, which is the reconciliation key', () => {
    const premium = paymentInstruction(account);
    const programAssessment = paymentInstruction(account, assessment);
    expect(programAssessment.referencePrefix).toBe(assessment.paymentAccount.referencePrefix);
    expect(programAssessment.referencePrefix).not.toBe(premium.referencePrefix);
  });

  it('ignores a stale account stored on the assessment row', () => {
    // The assessment table keeps its own account columns; a drifted copy must never be
    // shown to a subscriber as an alternative destination.
    const stale = { ...assessment, paymentAccount: { beneficiary: 'Old', bank: 'Old Bank', accountNumber: '1111111111', referencePrefix: 'FUTO CAC' } };
    const instruction = paymentInstruction(account, stale);
    expect(instruction.accountNumber).toBe(account.accountNumber);
    expect(instruction.bank).toBe(account.bank);
    expect(instruction.referencePrefix).toBe('FUTO CAC');
  });
});
