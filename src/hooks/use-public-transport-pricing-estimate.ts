import { useCallback, useEffect, useRef, useState } from "react";
import {
  asPassengerEstimate,
  pricingDb,
  type JsonValue,
  type PassengerEstimate,
} from "@/lib/pricing-api";

type PublicPricingRpc = (
  name: "public_transport_pricing_estimate",
  args: { p_distance_km: number; p_effective_at?: string },
) => PromiseLike<{ data: JsonValue | null; error: { message: string } | null }>;

/**
 * The Supabase client's `rpc` reads `this.rest`, so it must stay bound to the
 * client. Detaching it (`const rpc = supabase.rpc`) throws
 * "Cannot read properties of undefined (reading 'rest')".
 */
const publicPricingRpc: PublicPricingRpc = (name, args) =>
  (pricingDb.rpc as unknown as PublicPricingRpc).call(pricingDb, name, args);

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
  const [attempt, setAttempt] = useState(0);
  /** Monotonic request id — only the newest response may write state. */
  const seqRef = useRef(0);

  useEffect(() => {
    if (distanceKm == null || distanceKm < 0) {
      seqRef.current += 1;
      setEstimate(null);
      setError(null);
      setLoading(false);
      return;
    }

    const cacheKey = `${distanceKm.toFixed(2)}|${effectiveAt ?? "now"}`;
    const cached = priceCache.get(cacheKey);
    if (cached && cached.expiresAt > Date.now()) {
      seqRef.current += 1;
      setEstimate(cached.estimate);
      setError(null);
      setLoading(false);
      return;
    }
    if (cached) priceCache.delete(cacheKey);

    const seq = ++seqRef.current;
    const isCurrent = () => seqRef.current === seq;
    setLoading(true);
    setError(null);

    // Everything runs inside the async closure so a synchronous throw from the
    // client becomes an inline, retryable error instead of unmounting the
    // calculator through the error boundary.
    void (async () => {
      try {
        const { data, error: estimateError } = await publicPricingRpc(
          "public_transport_pricing_estimate",
          {
            p_distance_km: distanceKm,
            p_effective_at: effectiveAt ?? undefined,
          },
        );
        if (!isCurrent()) return;
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
      } catch (estimateError: unknown) {
        if (!isCurrent()) return;
        setEstimate(null);
        setError(
          estimateError instanceof Error
            ? estimateError.message
            : "Could not calculate the trip price",
        );
      } finally {
        if (isCurrent()) setLoading(false);
      }
    })();
  }, [distanceKm, effectiveAt, attempt]);

  const retry = useCallback(() => {
    if (distanceKm != null) priceCache.delete(`${distanceKm.toFixed(2)}|${effectiveAt ?? "now"}`);
    setAttempt((value) => value + 1);
  }, [distanceKm, effectiveAt]);

  return { estimate, loading, error, retry };
}
