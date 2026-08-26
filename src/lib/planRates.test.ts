import { describe, expect, it } from 'vitest';
import { planOfferings } from '../data/demo';
import { nairaToKobo } from './money';

describe('negotiated 2026 plan premiums', () => {
  it('uses the agreed 2025 rates for every active 2026 offering', () => {
    const expected: Record<string, [number, number]> = {
      PLUS: [58_685, 264_083],
      PREMIUM: [94_768, 426_453],
      PREMIUM_PLUS: [132_471, 596_119],
      PRESTIGE: [194_079, 873_354],
      PRESTIGE_PLUS: [315_181, 1_418_314],
      EXECUTIVE_PRESTIGE: [534_276, 2_404_240],
    };

    expect(Object.fromEntries(planOfferings.map((plan) => [
      plan.code,
      [plan.individualPremiumKobo, plan.familyPremiumKobo],
    ]))).toEqual(Object.fromEntries(Object.entries(expected).map(([code, rates]) => [
      code,
      rates.map(nairaToKobo),
    ])));
  });
});
