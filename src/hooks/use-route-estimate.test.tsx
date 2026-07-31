import { describe, expect, it, vi } from "vitest";
import { act, renderHook, waitFor } from "@testing-library/react";
import { routePairKey, useRouteEstimate, type RoutePoint } from "@/hooks/use-route-estimate";

vi.mock("@tanstack/react-start", () => ({
  useServerFn: (fn: unknown) => fn,
}));
vi.mock("@/lib/maps.functions", () => ({
  computeRoute: vi.fn(),
}));

const A: RoutePoint = { lat: -26.1076, lng: 28.0567 };
const B: RoutePoint = { lat: -26.1367, lng: 28.2411 };
const C: RoutePoint = { lat: -25.7479, lng: 28.2293 };

function deferred<T>() {
  let resolve!: (v: T) => void;
  let reject!: (e: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

describe("routePairKey", () => {
  it("is stable for equal coordinates and null when incomplete", () => {
    expect(routePairKey(A, B)).toBe(routePairKey({ ...A }, { ...B }));
    expect(routePairKey(A, null)).toBeNull();
    expect(routePairKey(null, B)).toBeNull();
    expect(routePairKey(A, B)).not.toBe(routePairKey(A, C));
  });
});

describe("useRouteEstimate", () => {
  it("computes once per coordinate pair and exposes distance + duration", async () => {
    const fn = vi.fn().mockResolvedValue({ distanceKm: 34.48, durationMin: 38 });
    const { result, rerender } = renderHook(
      ({ o, d }: { o: RoutePoint | null; d: RoutePoint | null }) => useRouteEstimate(o, d, fn),
      { initialProps: { o: A as RoutePoint | null, d: null as RoutePoint | null } },
    );
    expect(fn).not.toHaveBeenCalled();

    rerender({ o: A, d: B });
    await waitFor(() => expect(result.current.distanceKm).toBe(34.48));
    expect(result.current.durationMin).toBe(38);
    expect(result.current.estimating).toBe(false);
    expect(result.current.error).toBeNull();

    // New object identity, same coordinates → no extra request.
    rerender({ o: { ...A }, d: { ...B } });
    await waitFor(() => expect(fn).toHaveBeenCalledTimes(1));
  });

  it("ignores stale responses so the newest selection always wins", async () => {
    const first = deferred<{ distanceKm: number; durationMin: number }>();
    const second = deferred<{ distanceKm: number; durationMin: number }>();
    const fn = vi
      .fn()
      .mockImplementationOnce(() => first.promise)
      .mockImplementationOnce(() => second.promise);

    const { result, rerender } = renderHook(
      ({ o, d }: { o: RoutePoint | null; d: RoutePoint | null }) => useRouteEstimate(o, d, fn),
      { initialProps: { o: A as RoutePoint | null, d: B as RoutePoint | null } },
    );

    rerender({ o: A, d: C });
    await act(async () => {
      second.resolve({ distanceKm: 50.2, durationMin: 45 });
      await second.promise;
    });
    await waitFor(() => expect(result.current.distanceKm).toBe(50.2));

    // The stale first request resolves last and must NOT overwrite.
    await act(async () => {
      first.resolve({ distanceKm: 34.48, durationMin: 38 });
      await first.promise;
    });
    expect(result.current.distanceKm).toBe(50.2);
    expect(result.current.durationMin).toBe(45);
  });

  it("does not let a stale failure clear a newer successful estimate", async () => {
    const first = deferred<{ distanceKm: number; durationMin: number }>();
    const fn = vi
      .fn()
      .mockImplementationOnce(() => first.promise)
      .mockImplementationOnce(() => Promise.resolve({ distanceKm: 12.5, durationMin: 20 }));

    const { result, rerender } = renderHook(
      ({ o, d }: { o: RoutePoint | null; d: RoutePoint | null }) => useRouteEstimate(o, d, fn),
      { initialProps: { o: A as RoutePoint | null, d: B as RoutePoint | null } },
    );
    rerender({ o: A, d: C });
    await waitFor(() => expect(result.current.distanceKm).toBe(12.5));

    await act(async () => {
      first.reject(new Error("Route compute failed (500)"));
      await first.promise.catch(() => undefined);
    });
    expect(result.current.distanceKm).toBe(12.5);
    expect(result.current.error).toBeNull();
  });

  it("surfaces errors and recovers via retry()", async () => {
    const fn = vi
      .fn()
      .mockRejectedValueOnce(new Error("Google Maps connector not configured"))
      .mockResolvedValueOnce({ distanceKm: 34.48, durationMin: 38 });

    const { result } = renderHook(() => useRouteEstimate(A, B, fn));
    await waitFor(() => expect(result.current.error).toBe("Google Maps connector not configured"));
    expect(result.current.distanceKm).toBeNull();
    expect(result.current.estimating).toBe(false);

    act(() => result.current.retry());
    await waitFor(() => expect(result.current.distanceKm).toBe(34.48));
    expect(result.current.error).toBeNull();
    expect(fn).toHaveBeenCalledTimes(2);
  });

  it("clears state when a point is removed", async () => {
    const fn = vi.fn().mockResolvedValue({ distanceKm: 34.48, durationMin: 38 });
    const { result, rerender } = renderHook(
      ({ o, d }: { o: RoutePoint | null; d: RoutePoint | null }) => useRouteEstimate(o, d, fn),
      { initialProps: { o: A as RoutePoint | null, d: B as RoutePoint | null } },
    );
    await waitFor(() => expect(result.current.distanceKm).toBe(34.48));
    rerender({ o: A, d: null });
    await waitFor(() => expect(result.current.distanceKm).toBeNull());
    expect(result.current.estimating).toBe(false);
  });
});
