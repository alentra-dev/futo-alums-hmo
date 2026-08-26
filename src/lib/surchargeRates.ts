import type { EnrollmentPeriod } from './types';
import { DEFAULT_SURCHARGE_RATES, type SurchargeRates } from './money';
import { isDemoMode, supabase } from './supabase';

export function surchargeRates(period?: Partial<EnrollmentPeriod> | null): SurchargeRates {
  return {
    nhisFeeBasisPoints: period?.nhisFeeBasisPoints ?? DEFAULT_SURCHARGE_RATES.nhisFeeBasisPoints,
    programFeeBasisPoints: period?.programFeeBasisPoints ?? DEFAULT_SURCHARGE_RATES.programFeeBasisPoints,
  };
}

export async function loadSurchargeRates(periodId: string): Promise<SurchargeRates> {
  if (isDemoMode || !supabase) return DEFAULT_SURCHARGE_RATES;
  const { data, error } = await supabase.rpc('get_period_surcharge_rates', { p_period_id: periodId });
  if (error) throw error;
  return { ...DEFAULT_SURCHARGE_RATES, ...(data as Partial<SurchargeRates> | null) };
}

export function withSurchargeRates<T extends EnrollmentPeriod>(period: T, rates: SurchargeRates): T {
  return { ...period, ...rates };
}
