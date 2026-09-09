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

    let cancelled = false;
    const timer = window.setTimeout(() => {
      setLoading(true);
      setError(null);
      publicPricingRpc("public_transport_pricing_estimate", {
        p_distance_km: distanceKm,
        p_effective_at: effectiveAt ?? undefined,
      }).then(({ data, error: estimateError }) => {
        if (cancelled) return;
        if (estimateError) {
          setEstimate(null);
          setError(estimateError.message);
        } else {
          const next = asPassengerEstimate(data);
          setEstimate(next);
          setError(next ? null : "The pricing service returned an invalid estimate");
        }
        setLoading(false);
      });
    }, 150);

    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [distanceKm, effectiveAt]);

  return { estimate, loading, error };
}
