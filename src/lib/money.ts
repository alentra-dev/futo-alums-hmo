export const KOBO_PER_NAIRA = 100;
export const NHIS_FEE_BASIS_POINTS = 100;
export const PROGRAM_FEE_BASIS_POINTS = 200;

export interface SurchargeRates {
  nhisFeeBasisPoints: number;
  programFeeBasisPoints: number;
}

export const DEFAULT_SURCHARGE_RATES: SurchargeRates = {
  nhisFeeBasisPoints: NHIS_FEE_BASIS_POINTS,
  programFeeBasisPoints: PROGRAM_FEE_BASIS_POINTS,
};

export function calculateFees(premiumKobo: number, rates: SurchargeRates = DEFAULT_SURCHARGE_RATES) {
  const nhisFeeKobo = Math.round((premiumKobo * rates.nhisFeeBasisPoints) / 10_000);
  const reserveFeeKobo = Math.round((premiumKobo * rates.programFeeBasisPoints) / 10_000);
  const programFeeKobo = nhisFeeKobo + reserveFeeKobo;
  const subtotalKobo = premiumKobo + programFeeKobo;
  return {
    premiumKobo,
    nhisFeeKobo,
    reserveFeeKobo,
    totalFeeKobo: programFeeKobo,
    programFeeKobo,
    subtotalKobo,
    subscriberTotalKobo: subtotalKobo,
  };
}

export function formatNaira(kobo: number, showKobo = true) {
  return new Intl.NumberFormat('en-NG', {
    style: 'currency',
    currency: 'NGN',
    minimumFractionDigits: showKobo ? 2 : 0,
    maximumFractionDigits: showKobo ? 2 : 0,
  }).format(kobo / KOBO_PER_NAIRA);
}

export function nairaToKobo(value: number | string) {
  const normalized = typeof value === 'string' ? Number(value.replace(/[^\d.-]/g, '')) : value;
  return Math.round(normalized * KOBO_PER_NAIRA);
}

export function planTotalKobo(premiumKobo: number, rates: SurchargeRates = DEFAULT_SURCHARGE_RATES) {
  return calculateFees(premiumKobo, rates).subscriberTotalKobo;
}

export function formatBasisPoints(basisPoints: number) {
  return new Intl.NumberFormat('en-NG', { maximumFractionDigits: 2 }).format(basisPoints / 100);
}

export type PaymentPositionStatus = 'underpaid' | 'paid in full' | 'overpaid';

export interface PaymentPosition {
  status: PaymentPositionStatus;
  differenceKobo: number;
  underpaymentKobo: number;
  overpaymentKobo: number;
}

export function paymentPosition(totalKobo: number, verifiedKobo: number): PaymentPosition {
  const differenceKobo = verifiedKobo - totalKobo;
  return {
    status: differenceKobo < 0 ? 'underpaid' : differenceKobo > 0 ? 'overpaid' : 'paid in full',
    differenceKobo,
    underpaymentKobo: Math.max(0, -differenceKobo),
    overpaymentKobo: Math.max(0, differenceKobo),
  };
}
