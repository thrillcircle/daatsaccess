import { useEffect, useState } from "react";
import {
  asPassengerEstimate,
  pricingDb,
  type JsonValue,
  type PassengerEstimate,
} from "@/lib/pricing-api";

const publicPricingRpc = pricingDb.rpc as unknown as (
  name: "public_transport_pricing_estimate",
  args: { p_distance_km: number; p_effective_at?: string },
) => PromiseLike<{ data: JsonValue | null; error: { message: string } | null }>;

const PRICE_CACHE_TTL_MS = 5 * 60_000;
const priceCache = new Map<string, { estimate: PassengerEstimate; expiresAt: number }>();

export function usePublicTransportPricingEstimate({
  distanceKm,
  effectiveAt,
}: {
  distanceKm: number | null;
  effectiveAt?: string | null;
}) {
  const [estimate, setEstimate] = useState<PassengerEstimate | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (distanceKm == null || distanceKm < 0) {
      setEstimate(null);
      setError(null);
      setLoading(false);
      return;
    }

    const cacheKey = `${distanceKm.toFixed(2)}|${effectiveAt ?? "now"}`;
    const cached = priceCache.get(cacheKey);
    if (cached && cached.expiresAt > Date.now()) {
      setEstimate(cached.estimate);
      setError(null);
      setLoading(false);
      return;
    }
    if (cached) priceCache.delete(cacheKey);

    let cancelled = false;
    setLoading(true);
    setError(null);
    void Promise.resolve(
      publicPricingRpc("public_transport_pricing_estimate", {
        p_distance_km: distanceKm,
        p_effective_at: effectiveAt ?? undefined,
      }),
    )
      .then(({ data, error: estimateError }) => {
        if (cancelled) return;
        if (estimateError) {
          setEstimate(null);
          setError(estimateError.message);
        } else {
          const next = asPassengerEstimate(data);
          setEstimate(next);
          setError(next ? null : "The pricing service returned an invalid estimate");
          if (next) {
            priceCache.set(cacheKey, {
              estimate: next,
              expiresAt: Date.now() + PRICE_CACHE_TTL_MS,
            });
          }
        }
        setLoading(false);
      })
      .catch((estimateError: unknown) => {
        if (cancelled) return;
        setEstimate(null);
        setError(
          estimateError instanceof Error
            ? estimateError.message
            : "Could not calculate the trip price",
        );
        setLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [distanceKm, effectiveAt]);

  return { estimate, loading, error };
}
