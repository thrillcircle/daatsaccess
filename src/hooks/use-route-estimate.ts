import { useCallback, useEffect, useRef, useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { computeRoute, type RouteEstimate } from "@/lib/maps.functions";

export type RoutePoint = { lat: number; lng: number };

export type RouteEstimateState = {
  distanceKm: number | null;
  durationMin: number | null;
  estimating: boolean;
  error: string | null;
  retry: () => void;
};

/** Stable identity for a coordinate pair — 6dp ≈ 0.1 m, plenty for routing. */
export function routePairKey(
  origin: RoutePoint | null,
  destination: RoutePoint | null,
): string | null {
  if (!origin || !destination) return null;
  const n = (v: number) => v.toFixed(6);
  return `${n(origin.lat)},${n(origin.lng)}|${n(destination.lat)},${n(destination.lng)}`;
}

type ComputeRouteFn = (opts: {
  data: { originLat: number; originLng: number; destLat: number; destLng: number };
}) => Promise<RouteEstimate>;

/**
 * Computes the driving route for a pickup/destination pair exactly once per
 * distinct coordinate pair.
 *
 * Race safety: every request carries a monotonic sequence number and only the
 * newest sequence may write state, so a slow response for an older pair can
 * never overwrite a newer selection (and cannot clear a newer result on error).
 */
export function useRouteEstimate(
  origin: RoutePoint | null,
  destination: RoutePoint | null,
  computeRouteFn?: ComputeRouteFn,
): RouteEstimateState {
  const serverComputeRoute = useServerFn(computeRoute) as unknown as ComputeRouteFn;
  const run = computeRouteFn ?? serverComputeRoute;
  const runRef = useRef(run);
  runRef.current = run;

  const [distanceKm, setDistanceKm] = useState<number | null>(null);
  const [durationMin, setDurationMin] = useState<number | null>(null);
  const [estimating, setEstimating] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [attempt, setAttempt] = useState(0);

  const seqRef = useRef(0);
  const pairKey = routePairKey(origin, destination);
  const originLat = origin?.lat;
  const originLng = origin?.lng;
  const destLat = destination?.lat;
  const destLng = destination?.lng;

  useEffect(() => {
    if (
      pairKey == null ||
      originLat == null ||
      originLng == null ||
      destLat == null ||
      destLng == null
    ) {
      seqRef.current += 1;
      setDistanceKm(null);
      setDurationMin(null);
      setEstimating(false);
      setError(null);
      return;
    }

    const seq = ++seqRef.current;
    const isCurrent = () => seqRef.current === seq;

    setEstimating(true);
    setError(null);

    void (async () => {
      try {
        const result = await runRef.current({
          data: { originLat, originLng, destLat, destLng },
        });
        if (!isCurrent()) return;
        setDistanceKm(result.distanceKm);
        setDurationMin(result.durationMin);
        setError(null);
      } catch (err: unknown) {
        if (!isCurrent()) return;
        setDistanceKm(null);
        setDurationMin(null);
        setError(err instanceof Error ? err.message : "Could not calculate the route");
      } finally {
        if (isCurrent()) setEstimating(false);
      }
    })();
    // `pairKey` fully describes the coordinates; the individual values are read
    // above and never change without the key changing.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pairKey, attempt]);

  const retry = useCallback(() => setAttempt((a) => a + 1), []);

  return { distanceKm, durationMin, estimating, error, retry };
}
