export const KOBO_PER_NAIRA = 100;
export const TOTAL_FEE_BASIS_POINTS = 300;
export const NHIS_FEE_BASIS_POINTS = 100;
export const RESERVE_FEE_BASIS_POINTS = 200;

export function calculateFees(premiumKobo: number) {
  const nhisFeeKobo = Math.round((premiumKobo * NHIS_FEE_BASIS_POINTS) / 10_000);
  const reserveFeeKobo = Math.round((premiumKobo * RESERVE_FEE_BASIS_POINTS) / 10_000);
  return {
    premiumKobo,
    nhisFeeKobo,
    reserveFeeKobo,
    totalFeeKobo: nhisFeeKobo + reserveFeeKobo,
    subscriberTotalKobo: premiumKobo + nhisFeeKobo + reserveFeeKobo,
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

export function planTotalKobo(premiumKobo: number) {
  return calculateFees(premiumKobo).subscriberTotalKobo;
}
