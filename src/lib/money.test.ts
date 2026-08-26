import { describe, expect, it } from 'vitest';
import { calculateFees, formatNaira, nairaToKobo, planTotalKobo } from './money';

describe('money calculations', () => {
  it('calculates the 1% AVON NHIS and 15% program fees in kobo', () => {
    expect(calculateFees(5_868_500)).toEqual({
      premiumKobo: 5_868_500,
      nhisFeeKobo: 58_685,
      reserveFeeKobo: 880_275,
      totalFeeKobo: 938_960,
      programFeeKobo: 938_960,
      subtotalKobo: 6_807_460,
      subscriberTotalKobo: 6_807_460,
    });
  });

  it('rounds each fee allocation to the nearest kobo', () => {
    const result = calculateFees(10_001);
    expect(result.nhisFeeKobo).toBe(100);
    expect(result.reserveFeeKobo).toBe(1_500);
    expect(result.subscriberTotalKobo).toBe(11_601);
  });

  it('uses administrator-configured rates', () => {
    expect(calculateFees(10_000, { nhisFeeBasisPoints: 125, programFeeBasisPoints: 250 })).toMatchObject({
      nhisFeeKobo: 125, reserveFeeKobo: 250, subscriberTotalKobo: 10_375,
    });
  });

  it('keeps the subscriber total equal to all allocations', () => {
    const premium = nairaToKobo('426,453.00');
    const fees = calculateFees(premium);
    expect(planTotalKobo(premium)).toBe(fees.premiumKobo + fees.programFeeKobo);
    expect(formatNaira(fees.subscriberTotalKobo)).toContain('494,685.48');
  });
});
