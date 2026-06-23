export const BASE_FARE_ZAR = 20;
export const PER_KM_ZAR = 13.5;

export function estimatePrice(distanceKm: number): number {
  return Math.round((BASE_FARE_ZAR + distanceKm * PER_KM_ZAR) * 100) / 100;
}

export function formatZAR(amount: number): string {
  return new Intl.NumberFormat("en-ZA", {
    style: "currency",
    currency: "ZAR",
    maximumFractionDigits: 2,
  }).format(amount);
}
