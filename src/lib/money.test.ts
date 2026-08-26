import { describe, expect, it } from 'vitest';
import { calculateFees, formatNaira, nairaToKobo, planTotalKobo } from './money';

describe('money calculations', () => {
  it('calculates the program fee and 15% transaction tax in kobo', () => {
    expect(calculateFees(5_868_500)).toEqual({
      premiumKobo: 5_868_500,
      nhisFeeKobo: 58_685,
      reserveFeeKobo: 117_370,
      totalFeeKobo: 176_055,
      programFeeKobo: 176_055,
      subtotalKobo: 6_044_555,
      transactionTaxFeeKobo: 906_683,
      subscriberTotalKobo: 6_951_238,
    });
  });

  it('rounds each fee allocation to the nearest kobo', () => {
    const result = calculateFees(10_001);
    expect(result.nhisFeeKobo).toBe(100);
    expect(result.reserveFeeKobo).toBe(200);
    expect(result.transactionTaxFeeKobo).toBe(1_545);
    expect(result.subscriberTotalKobo).toBe(11_846);
  });

  it('keeps the subscriber total equal to all allocations', () => {
    const premium = nairaToKobo('426,453.00');
    const fees = calculateFees(premium);
    expect(planTotalKobo(premium)).toBe(fees.premiumKobo + fees.programFeeKobo + fees.transactionTaxFeeKobo);
    expect(formatNaira(fees.subscriberTotalKobo)).toContain('505,133.58');
  });
});
