import { Component, useState, type ErrorInfo, type ReactNode } from "react";
import { useNavigate } from "@tanstack/react-router";
import {
  Accessibility,
  ArrowRight,
  CalendarClock,
  CheckCircle2,
  HeartHandshake,
  Loader2,
  MapPin,
  Plane,
  RotateCcw,
  Route,
} from "lucide-react";
import { AddressAutocomplete, type AddressPick } from "@/components/AddressAutocomplete";
import { useRouteEstimate } from "@/hooks/use-route-estimate";
import { formatZAR } from "@/lib/pricing";
import { usePublicTransportPricingEstimate } from "@/hooks/use-public-transport-pricing-estimate";
import {
  PUBLIC_SERVICE_ROUTE,
  savePublicTripDraft,
  type PublicServiceCode,
} from "@/lib/public-trip-estimate";

const services = [
  {
    code: "transport",
    name: "Access Transport",
    detail: "Point-to-point accessible travel",
    icon: Accessibility,
  },
  {
    code: "assisted",
    name: "Access Assisted",
    detail: "Travel with trained companion support",
    icon: HeartHandshake,
  },
  {
    code: "appointment",
    name: "Access Appointment",
    detail: "Medical visits, therapy and rehabilitation",
    icon: CalendarClock,
  },
  {
    code: "extended",
    name: "Extended Journey",
    detail: "Multi-day and long-distance accessible travel",
    icon: Plane,
  },
] as const;

class PublicTripEstimatorBoundary extends Component<{ children: ReactNode }, { failed: boolean }> {
  state = { failed: false };

  static getDerivedStateFromError() {
    return { failed: true };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error("Homepage trip estimator failed", error, info);
  }

  render() {
    if (this.state.failed) {
      return (
        <div className="rounded-3xl border border-slate-200 bg-white p-6 shadow-xl shadow-slate-950/10 sm:p-8">
          <h2 className="text-2xl font-black tracking-tight text-blue-950">
            The trip calculator needs to restart
          </h2>
          <p className="mt-2 text-sm text-slate-600">
            The rest of the page is still available. Restart the calculator and try your route
            again.
          </p>
          <button
            type="button"
            onClick={() => this.setState({ failed: false })}
            className="mt-5 inline-flex min-h-11 items-center gap-2 rounded-xl bg-blue-700 px-5 font-extrabold text-white hover:bg-blue-800"
          >
            <RotateCcw className="h-4 w-4" /> Restart calculator
          </button>
        </div>
      );
    }
    return this.props.children;
  }
}

function minimumTravelTime() {
  const date = new Date(Date.now() + 60 * 60 * 1000);
  const offset = date.getTimezoneOffset();
  return new Date(date.getTime() - offset * 60_000).toISOString().slice(0, 16);
}

function PublicTripEstimatorForm({ isAuthenticated }: { isAuthenticated: boolean }) {
  const navigate = useNavigate();
  const [service, setService] = useState<PublicServiceCode>("transport");
  const [pickup, setPickup] = useState<AddressPick | null>(null);
  const [destination, setDestination] = useState<AddressPick | null>(null);
  const [travelAt, setTravelAt] = useState("");
  const { distanceKm, durationMin, estimating, error, retry } = useRouteEstimate(
    pickup,
    destination,
  );
  const travelDate = travelAt ? new Date(travelAt) : null;
  const {
    estimate: pricingEstimate,
    loading: pricingLoading,
    error: pricingError,
    retry: retryPricing,
  } = usePublicTransportPricingEstimate({
    distanceKm,
    effectiveAt:
      travelDate && !Number.isNaN(travelDate.getTime()) ? travelDate.toISOString() : null,
  });
  const indicativePrice = pricingEstimate?.total ?? null;
  const specialised = service !== "transport";
  const ready = Boolean(
    pickup &&
    destination &&
    travelAt &&
    indicativePrice != null &&
    !pricingLoading &&
    !pricingError,
  );

  function requestTrip(mode?: "signin" | "signup") {
    if (!ready || !pickup || !destination || distanceKm == null || indicativePrice == null) return;
    savePublicTripDraft({
      service,
      pickup,
      destination,
      travelAt,
      distanceKm,
      durationMin,
      indicativeTransportPrice: indicativePrice,
      createdAt: new Date().toISOString(),
    });
    if (isAuthenticated) {
      navigate({ to: PUBLIC_SERVICE_ROUTE[service] as never });
    } else {
      navigate({ to: "/auth", search: { mode: mode ?? "signin" } });
    }
  }

  return (
    <div className="rounded-3xl border border-slate-200 bg-white p-5 shadow-xl shadow-slate-950/10 sm:p-7">
      <div className="flex flex-col gap-2 border-b border-slate-200 pb-5 lg:flex-row lg:items-end lg:justify-between">
        <div>
          <h2 className="text-2xl font-black tracking-tight text-blue-950 sm:text-3xl">
            Where would you like to go?
          </h2>
          <p className="mt-1 text-sm text-slate-600">
            Explore services and see an indicative transport price before creating an account.
          </p>
        </div>
        <span className="inline-flex w-fit items-center gap-2 rounded-full bg-emerald-50 px-3 py-1.5 text-sm font-bold text-emerald-800">
          <CheckCircle2 className="h-4 w-4" /> No sign-in needed
        </span>
      </div>

      <fieldset className="mt-5">
        <legend className="text-sm font-extrabold text-slate-800">Choose a service</legend>
        <div className="mt-3 grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
          {services.map(({ code, name, detail, icon: Icon }) => {
            const selected = service === code;
            return (
              <button
                key={code}
                type="button"
                onClick={() => setService(code)}
                aria-pressed={selected}
                className={`grid min-h-28 grid-rows-[1.5rem_auto_1fr] rounded-2xl border p-4 text-left transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-600 ${selected ? "border-blue-600 bg-blue-50 shadow-sm" : "border-slate-200 hover:border-blue-300 hover:bg-slate-50"}`}
              >
                <Icon className={`h-6 w-6 ${selected ? "text-blue-700" : "text-slate-500"}`} />
                <span className="mt-3 block font-black text-blue-950">{name}</span>
                <span className="mt-1 block text-sm leading-5 text-slate-600">{detail}</span>
              </button>
            );
          })}
        </div>
      </fieldset>

      <div className="mt-5 grid gap-4 lg:grid-cols-[1fr_1fr_.72fr]">
        <AddressAutocomplete
          id="public-estimate-pickup"
          label="Pickup location"
          value={pickup}
          onChange={setPickup}
          placeholder="Search pickup address"
          enableCurrentLocation
          savedAddressesPlacement="after-input"
        />
        <AddressAutocomplete
          id="public-estimate-destination"
          label="Destination"
          value={destination}
          onChange={setDestination}
          placeholder="Search destination"
          bias={pickup}
        />
        <div className="space-y-1.5">
          <label htmlFor="public-estimate-date" className="text-sm font-medium text-slate-800">
            Travel date and time
          </label>
          <input
            id="public-estimate-date"
            type="datetime-local"
            min={minimumTravelTime()}
            value={travelAt}
            onChange={(event) => setTravelAt(event.target.value)}
            className="flex h-10 w-full rounded-md border border-slate-300 bg-white px-3 py-2 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-600"
          />
        </div>
      </div>

      <div className="mt-5 grid gap-4 rounded-2xl bg-slate-950 p-5 text-white lg:grid-cols-[1fr_auto] lg:items-center">
        <div aria-live="polite" aria-busy={estimating || pricingLoading}>
          {!pickup || !destination ? (
            <div className="flex items-center gap-3">
              <MapPin className="h-6 w-6 text-blue-300" />
              <div>
                <p className="font-black">Enter your route</p>
                <p className="text-sm text-slate-300">
                  Choose both addresses to calculate distance and price.
                </p>
              </div>
            </div>
          ) : estimating || pricingLoading ? (
            <div className="flex items-center gap-3">
              <Loader2 className="h-6 w-6 animate-spin text-blue-300" />
              <div>
                <p className="font-black">Calculating your trip…</p>
                <p className="text-sm text-slate-300">
                  Checking the driving route and current transport calculation.
                </p>
              </div>
            </div>
          ) : error || pricingError ? (
            <div className="flex items-center justify-between gap-4">
              <div>
                <p className="font-black">We could not calculate that route</p>
                <p className="text-sm text-slate-300">{error ?? pricingError}</p>
              </div>
              <button
                type="button"
                onClick={() => {
                  if (error) retry();
                  if (pricingError) retryPricing();
                }}
                className="inline-flex min-h-11 items-center gap-2 rounded-xl border border-white/30 px-4 font-bold"
              >
                <RotateCcw className="h-4 w-4" /> Retry
              </button>
            </div>
          ) : indicativePrice != null ? (
            <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
              <div className="flex items-center gap-3">
                <Route className="h-6 w-6 text-blue-300" />
                <div>
                  <p className="font-black">
                    {distanceKm?.toFixed(1)} km{" "}
                    {durationMin != null ? `• about ${durationMin} min` : ""}
                  </p>
                  <p className="text-sm text-slate-300">
                    {specialised ? "Indicative transport portion" : "Indicative trip price"}
                  </p>
                </div>
              </div>
              <div className="sm:text-right">
                <p className="text-3xl font-black">{formatZAR(indicativePrice)}</p>
                <p className="text-xs text-slate-300">
                  {specialised
                    ? "Assistance or service costs are quoted separately"
                    : "Final price is confirmed before booking"}
                </p>
              </div>
            </div>
          ) : null}
        </div>
        <button
          type="button"
          onClick={requestTrip}
          disabled={!ready || estimating || pricingLoading}
          className="inline-flex min-h-14 items-center justify-center gap-2 rounded-xl bg-blue-600 px-6 font-extrabold text-white transition hover:bg-blue-500 disabled:cursor-not-allowed disabled:bg-slate-700 disabled:text-slate-400"
        >
          Request this trip <ArrowRight className="h-5 w-5" />
        </button>
      </div>
      <p className="mt-3 text-xs leading-5 text-slate-500">
        Estimates are not confirmed quotations. Tolls, parking, waiting time, additional stops,
        after-hours travel and specialised assistance may change the final amount.
      </p>
    </div>
  );
}

export function PublicTripEstimator({ isAuthenticated }: { isAuthenticated: boolean }) {
  return (
    <PublicTripEstimatorBoundary>
      <PublicTripEstimatorForm isAuthenticated={isAuthenticated} />
    </PublicTripEstimatorBoundary>
  );
}
