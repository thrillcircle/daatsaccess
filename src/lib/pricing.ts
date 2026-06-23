export const BASE_FARE_ZAR = 20;
export const PER_KM_ZAR = 13.5;

export function estimatePrice(distanceKm: number): number {
  if (!Number.isFinite(distanceKm) || distanceKm < 0) {
    throw new Error("Distance must be a non-negative number");
  }

  const estimatedFare = BASE_FARE_ZAR + distanceKm * PER_KM_ZAR;

  return Math.round(estimatedFare * 100) / 100;
}

export function formatZAR(amount: number): string {
  return new Intl.NumberFormat("en-ZA", {
    style: "currency",
    currency: "ZAR",
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(amount);
}
