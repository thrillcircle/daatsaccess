import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";
import type { SupabaseClient } from "@supabase/supabase-js";
import { Calculator, Info, Loader2, Save } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth, useUserRoles } from "@/hooks/use-auth";
import { AdminShell } from "@/components/AdminShell";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { formatZAR } from "@/lib/pricing";
import { toast } from "sonner";

type ServiceKey = "ride" | "transport" | "assisted" | "appointment" | "extended_journey";

type PricingRule = {
  id: string;
  service_type: ServiceKey;
  currency: string;
  base_fare: number;
  per_km_rate: number;
  per_minute_rate: number;
  companion_hourly_rate: number;
  companion_minimum_hours: number;
  waiting_hourly_rate: number;
  specialist_vehicle_fee: number;
  vehicle_daily_rate: number;
  driver_daily_rate: number;
  driver_overnight_rate: number;
  companion_daily_rate: number;
  platform_margin_percent: number;
  is_active: boolean;
  is_mock: boolean;
  effective_from: string;
  updated_at: string;
  updated_by: string | null;
};

type PricingInsert = Omit<PricingRule, "id" | "updated_at"> & { id?: string; updated_at?: string };
type PricingUpdate = Partial<PricingInsert>;

type PricingDatabase = {
  public: {
    Tables: {
      service_pricing_rules: {
        Row: PricingRule;
        Insert: PricingInsert;
        Update: PricingUpdate;
        Relationships: [];
      };
    };
    Views: Record<string, never>;
    Functions: Record<string, never>;
    Enums: Record<string, never>;
    CompositeTypes: Record<string, never>;
  };
};

const pricingDb = supabase as unknown as SupabaseClient<PricingDatabase>;

const SERVICE_LABEL: Record<ServiceKey, string> = {
  ride: "Normal Ride",
  transport: "Access Transport",
  assisted: "Access Assisted",
  appointment: "Access Appointment",
  extended_journey: "Access Extended Journey",
};

const NUMBER_FIELDS: Array<{
  key: keyof PricingRule;
  label: string;
  step?: string;
  suffix?: string;
}> = [
  { key: "base_fare", label: "Base fare", step: "0.01", suffix: "ZAR" },
  { key: "per_km_rate", label: "Per kilometre", step: "0.01", suffix: "ZAR/km" },
  { key: "per_minute_rate", label: "Transport time", step: "0.01", suffix: "ZAR/min" },
  {
    key: "companion_hourly_rate",
    label: "Companion hourly rate",
    step: "0.01",
    suffix: "ZAR/hour",
  },
  {
    key: "companion_minimum_hours",
    label: "Minimum companion hours",
    step: "0.5",
    suffix: "hours",
  },
  { key: "waiting_hourly_rate", label: "Waiting time", step: "0.01", suffix: "ZAR/hour" },
  { key: "specialist_vehicle_fee", label: "Specialist vehicle fee", step: "0.01", suffix: "ZAR" },
  { key: "vehicle_daily_rate", label: "Vehicle daily rate", step: "0.01", suffix: "ZAR/day" },
  { key: "driver_daily_rate", label: "Driver daily rate", step: "0.01", suffix: "ZAR/day" },
  {
    key: "driver_overnight_rate",
    label: "Driver overnight allowance",
    step: "0.01",
    suffix: "ZAR/night",
  },
  { key: "companion_daily_rate", label: "Companion daily rate", step: "0.01", suffix: "ZAR/day" },
  { key: "platform_margin_percent", label: "Target gross margin", step: "0.1", suffix: "%" },
];

export const Route = createFileRoute("/app/admin/pricing-services")({
  head: () => ({ meta: [{ title: "Pricing & Services — Admin" }] }),
  component: PricingServicesPage,
});

function preview(rule: PricingRule): number {
  const companionHours = Math.max(2, Number(rule.companion_minimum_hours || 0));
  const deliveryCost =
    Number(rule.base_fare || 0) +
    Number(rule.per_km_rate || 0) * 10 +
    Number(rule.per_minute_rate || 0) * 60 +
    Number(rule.companion_hourly_rate || 0) * companionHours +
    Number(rule.waiting_hourly_rate || 0) +
    Number(rule.specialist_vehicle_fee || 0) +
    Number(rule.vehicle_daily_rate || 0) +
    Number(rule.driver_daily_rate || 0) +
    Number(rule.driver_overnight_rate || 0) +
    Number(rule.companion_daily_rate || 0);
  const margin = Math.min(95, Math.max(0, Number(rule.platform_margin_percent || 0))) / 100;
  return margin > 0 ? deliveryCost / (1 - margin) : deliveryCost;
}

function PricingServicesPage() {
  const { user, loading: authLoading } = useAuth();
  const { roles, loading: rolesLoading } = useUserRoles(user?.id);
  const navigate = useNavigate();
  const isAdmin = !!roles?.includes("admin");
  const [rows, setRows] = useState<PricingRule[]>([]);
  const [drafts, setDrafts] = useState<Record<string, PricingRule>>({});
  const [loading, setLoading] = useState(true);
  const [savingId, setSavingId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (authLoading || rolesLoading || roles === null) return;
    if (!user || !isAdmin) navigate({ to: "/app" });
  }, [authLoading, rolesLoading, roles, user, isAdmin, navigate]);

  const load = async () => {
    setLoading(true);
    setError(null);
    const { data, error: loadError } = await pricingDb
      .from("service_pricing_rules")
      .select("*")
      .order("service_type");
    if (loadError) {
      setError(loadError.message);
      setRows([]);
      setDrafts({});
    } else {
      const list = (data ?? []) as PricingRule[];
      setRows(list);
      setDrafts(Object.fromEntries(list.map((row) => [row.id, { ...row }])));
    }
    setLoading(false);
  };

  useEffect(() => {
    if (isAdmin) void load();
  }, [isAdmin]);

  const ordered = useMemo(
    () =>
      [...rows].sort(
        (a, b) =>
          Object.keys(SERVICE_LABEL).indexOf(a.service_type) -
          Object.keys(SERVICE_LABEL).indexOf(b.service_type),
      ),
    [rows],
  );

  const updateDraft = (id: string, patch: Partial<PricingRule>) => {
    setDrafts((previous) => ({ ...previous, [id]: { ...previous[id], ...patch } }));
  };

  const save = async (row: PricingRule) => {
    const draft = drafts[row.id];
    if (!draft || !user) return;
    setSavingId(row.id);
    const payload: PricingUpdate = {
      base_fare: Number(draft.base_fare),
      per_km_rate: Number(draft.per_km_rate),
      per_minute_rate: Number(draft.per_minute_rate),
      companion_hourly_rate: Number(draft.companion_hourly_rate),
      companion_minimum_hours: Number(draft.companion_minimum_hours),
      waiting_hourly_rate: Number(draft.waiting_hourly_rate),
      specialist_vehicle_fee: Number(draft.specialist_vehicle_fee),
      vehicle_daily_rate: Number(draft.vehicle_daily_rate),
      driver_daily_rate: Number(draft.driver_daily_rate),
      driver_overnight_rate: Number(draft.driver_overnight_rate),
      companion_daily_rate: Number(draft.companion_daily_rate),
      platform_margin_percent: Number(draft.platform_margin_percent),
      is_active: draft.is_active,
      is_mock: draft.is_mock,
      effective_from: draft.effective_from,
      updated_by: user.id,
    };
    const { error: saveError } = await pricingDb
      .from("service_pricing_rules")
      .update(payload)
      .eq("id", row.id);
    setSavingId(null);
    if (saveError) {
      toast.error(saveError.message);
      return;
    }
    toast.success(`${SERVICE_LABEL[row.service_type]} pricing saved`);
    await load();
  };

  if (authLoading || rolesLoading || (user && roles === null)) {
    return (
      <AdminShell title="Pricing & Services">
        <p className="text-sm text-muted-foreground">Loading…</p>
      </AdminShell>
    );
  }
  if (!isAdmin) return null;

  return (
    <AdminShell
      title="Pricing & Services"
      subtitle="Administrators control service rates here. Mock rates are clearly marked and can be replaced before launch."
    >
      <div className="mb-5 rounded-2xl border border-primary/25 bg-primary/5 p-4 text-sm">
        <div className="flex items-start gap-2">
          <Info className="mt-0.5 h-4 w-4 shrink-0 text-primary" />
          <div>
            <p className="font-medium">Current confirmed formula</p>
            <p className="text-muted-foreground">
              Normal Ride and Access Transport remain R20.00 base fare + R13.50 per kilometre.
            </p>
            <p className="mt-1 text-xs text-muted-foreground">
              Other values are draft mock data. This module stores and previews the rates now; Phase
              4 will connect every specialised booking and quote calculation to the active pricing
              version.
            </p>
          </div>
        </div>
      </div>

      {error ? (
        <div className="rounded-2xl border border-destructive/40 bg-destructive/5 p-4 text-sm text-destructive">
          Could not load pricing rules: {error}. Apply the new Supabase migration before using this
          page.
        </div>
      ) : loading ? (
        <div className="rounded-2xl border bg-card p-8 text-center text-sm text-muted-foreground">
          <Loader2 className="mx-auto mb-2 h-5 w-5 animate-spin" /> Loading pricing rules…
        </div>
      ) : (
        <div className="space-y-5">
          {ordered.map((row) => {
            const draft = drafts[row.id] ?? row;
            return (
              <section key={row.id} className="rounded-2xl border bg-card p-4 shadow-sm">
                <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                  <div>
                    <div className="flex flex-wrap items-center gap-2">
                      <h2 className="text-lg font-semibold">{SERVICE_LABEL[row.service_type]}</h2>
                      <Badge variant={draft.is_mock ? "secondary" : "default"}>
                        {draft.is_mock ? "Mock rates" : "Confirmed base"}
                      </Badge>
                      <Badge variant={draft.is_active ? "outline" : "destructive"}>
                        {draft.is_active ? "Active" : "Inactive"}
                      </Badge>
                    </div>
                    <p className="mt-1 text-xs text-muted-foreground">
                      Effective from {new Date(draft.effective_from).toLocaleDateString("en-ZA")}
                    </p>
                  </div>
                  <div className="flex items-center gap-2">
                    <Label htmlFor={`active-${row.id}`} className="text-xs">
                      Service active
                    </Label>
                    <Switch
                      id={`active-${row.id}`}
                      checked={draft.is_active}
                      onCheckedChange={(checked) => updateDraft(row.id, { is_active: checked })}
                    />
                  </div>
                </div>

                <div className="mt-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
                  {NUMBER_FIELDS.map((field) => (
                    <div key={String(field.key)} className="space-y-1.5">
                      <Label htmlFor={`${row.id}-${String(field.key)}`} className="text-xs">
                        {field.label}
                      </Label>
                      <div className="relative">
                        <Input
                          id={`${row.id}-${String(field.key)}`}
                          type="number"
                          min="0"
                          step={field.step ?? "1"}
                          value={Number(draft[field.key] ?? 0)}
                          onChange={(event) =>
                            updateDraft(row.id, {
                              [field.key]: Number(event.target.value),
                            } as Partial<PricingRule>)
                          }
                          className="pr-20"
                        />
                        <span className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-[10px] text-muted-foreground">
                          {field.suffix}
                        </span>
                      </div>
                    </div>
                  ))}
                </div>

                <div className="mt-4 flex flex-col gap-3 rounded-xl bg-secondary p-3 sm:flex-row sm:items-center sm:justify-between">
                  <div className="flex items-start gap-2 text-sm">
                    <Calculator className="mt-0.5 h-4 w-4 text-primary" />
                    <div>
                      <p className="font-medium">
                        Mock calculation preview: {formatZAR(preview(draft))}
                      </p>
                      <p className="text-xs text-muted-foreground">
                        10 km, 60 transport minutes, minimum companion hours, 1 waiting hour and 1
                        daily unit where configured.
                      </p>
                    </div>
                  </div>
                  <div className="flex flex-wrap items-center gap-3">
                    <label className="flex items-center gap-2 text-xs">
                      <Switch
                        checked={draft.is_mock}
                        onCheckedChange={(checked) => updateDraft(row.id, { is_mock: checked })}
                      />
                      Mark as mock
                    </label>
                    <Button onClick={() => void save(row)} disabled={savingId === row.id}>
                      {savingId === row.id ? (
                        <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                      ) : (
                        <Save className="mr-2 h-4 w-4" />
                      )}
                      Save rates
                    </Button>
                  </div>
                </div>
              </section>
            );
          })}
        </div>
      )}
    </AdminShell>
  );
}
