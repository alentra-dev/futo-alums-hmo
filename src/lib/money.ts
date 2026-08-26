export const KOBO_PER_NAIRA = 100;
export const TOTAL_FEE_BASIS_POINTS = 300;
export const NHIS_FEE_BASIS_POINTS = 100;
export const RESERVE_FEE_BASIS_POINTS = 200;
export const TRANSACTION_TAX_BASIS_POINTS = 1500;

export interface SurchargeRates {
  nhisFeeBasisPoints: number;
  programFeeBasisPoints: number;
  transactionTaxBasisPoints: number;
}

export const DEFAULT_SURCHARGE_RATES: SurchargeRates = {
  nhisFeeBasisPoints: NHIS_FEE_BASIS_POINTS,
  programFeeBasisPoints: RESERVE_FEE_BASIS_POINTS,
  transactionTaxBasisPoints: TRANSACTION_TAX_BASIS_POINTS,
};

export function calculateFees(premiumKobo: number, rates: SurchargeRates = DEFAULT_SURCHARGE_RATES) {
  const nhisFeeKobo = Math.round((premiumKobo * rates.nhisFeeBasisPoints) / 10_000);
  const reserveFeeKobo = Math.round((premiumKobo * rates.programFeeBasisPoints) / 10_000);
  const programFeeKobo = nhisFeeKobo + reserveFeeKobo;
  const subtotalKobo = premiumKobo + programFeeKobo;
  const transactionTaxFeeKobo = Math.round((subtotalKobo * rates.transactionTaxBasisPoints) / 10_000);
  return {
    premiumKobo,
    nhisFeeKobo,
    reserveFeeKobo,
    totalFeeKobo: programFeeKobo,
    programFeeKobo,
    subtotalKobo,
    transactionTaxFeeKobo,
    subscriberTotalKobo: subtotalKobo + transactionTaxFeeKobo,
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
