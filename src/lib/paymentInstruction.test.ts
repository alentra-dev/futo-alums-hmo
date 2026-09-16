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
    expect(programAssessment.referencePrefix).toBe(assessment.referencePrefix);
    expect(programAssessment.referencePrefix).not.toBe(premium.referencePrefix);
  });

  it('can only contribute a reference, never an alternative destination', () => {
    // Migration 202609160021 removed the duplicate account columns, so the type system
    // no longer lets an assessment name a different bank or account number.
    const instruction = paymentInstruction(account, { referencePrefix: 'FUTO CAC' });
    expect(instruction.accountNumber).toBe(account.accountNumber);
    expect(instruction.bank).toBe(account.bank);
    expect(instruction.beneficiary).toBe(account.beneficiary);
    expect(instruction.referencePrefix).toBe('FUTO CAC');
  });
});
