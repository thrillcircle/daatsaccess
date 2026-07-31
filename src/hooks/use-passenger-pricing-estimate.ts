import { useEffect, useState } from "react";
import {
  asPassengerEstimate,
  pricingDb,
  type JsonValue,
  type PassengerEstimate,
} from "@/lib/pricing-api";

export function usePassengerPricingEstimate({
  serviceCode,
  distanceKm,
  effectiveAt,
  additionalInputs = {},
}: {
  serviceCode: "ride" | "transport";
  distanceKm: number | null;
  effectiveAt?: string | null;
  additionalInputs?: Record<string, number | boolean | undefined>;
}) {
  const [estimate, setEstimate] = useState<PassengerEstimate | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const additionalKey = JSON.stringify(additionalInputs);

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
      const payload = JSON.parse(additionalKey) as JsonValue;
      pricingDb
        .rpc("passenger_pricing_estimate", {
          p_service_code: serviceCode,
          p_distance_km: distanceKm,
          p_effective_at: effectiveAt ?? undefined,
          p_additional_inputs: payload,
        })
        .then(({ data, error: estimateError }) => {
          if (cancelled) return;
          if (estimateError) {
            setEstimate(null);
            setError(estimateError.message);
          } else {
            const next = asPassengerEstimate(data);
            if (!next) {
              setEstimate(null);
              setError("The pricing service returned an invalid estimate");
            } else {
              setEstimate(next);
            }
          }
          setLoading(false);
        });
    }, 150);

    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [additionalKey, distanceKm, effectiveAt, serviceCode]);

  return { estimate, loading, error };
}
