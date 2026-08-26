import { describe, expect, it } from 'vitest';
import { calculateFees, formatNaira, nairaToKobo, planTotalKobo } from './money';

describe('money calculations', () => {
  it('calculates the 1% NHIS fee and 2% reserve in kobo', () => {
    expect(calculateFees(5_868_500)).toEqual({
      premiumKobo: 5_868_500,
      nhisFeeKobo: 58_685,
      reserveFeeKobo: 117_370,
      totalFeeKobo: 176_055,
      subscriberTotalKobo: 6_044_555,
    });
  });

  it('rounds each fee allocation to the nearest kobo', () => {
    const result = calculateFees(10_001);
    expect(result.nhisFeeKobo).toBe(100);
    expect(result.reserveFeeKobo).toBe(200);
    expect(result.subscriberTotalKobo).toBe(10_301);
  });

  it('keeps the subscriber total equal to all allocations', () => {
    const premium = nairaToKobo('426,453.00');
    const fees = calculateFees(premium);
    expect(planTotalKobo(premium)).toBe(fees.premiumKobo + fees.nhisFeeKobo + fees.reserveFeeKobo);
    expect(formatNaira(fees.subscriberTotalKobo)).toContain('439,246.59');
  });
});
