import { describe, expect, it } from 'vitest';
import { calculateFees, formatNaira, nairaToKobo, planTotalKobo } from './money';

describe('money calculations', () => {
  it('calculates the 1% NHIS fee and 2% reserve in kobo', () => {
    expect(calculateFees(7_761_500)).toEqual({
      premiumKobo: 7_761_500,
      nhisFeeKobo: 77_615,
      reserveFeeKobo: 155_230,
      totalFeeKobo: 232_845,
      subscriberTotalKobo: 7_994_345,
    });
  });

  it('rounds each fee allocation to the nearest kobo', () => {
    const result = calculateFees(10_001);
    expect(result.nhisFeeKobo).toBe(100);
    expect(result.reserveFeeKobo).toBe(200);
    expect(result.subscriberTotalKobo).toBe(10_301);
  });

  it('keeps the subscriber total equal to all allocations', () => {
    const premium = nairaToKobo('469,060.00');
    const fees = calculateFees(premium);
    expect(planTotalKobo(premium)).toBe(fees.premiumKobo + fees.nhisFeeKobo + fees.reserveFeeKobo);
    expect(formatNaira(fees.subscriberTotalKobo)).toContain('483,131.80');
  });
});
