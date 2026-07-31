import { useCallback, useEffect, useMemo, useState } from "react";
import { Calculator, Copy, History, Loader2, Plus, Save, Send, ShieldCheck } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import { formatZAR } from "@/lib/pricing";
import {
  asCalculationSnapshot,
  pricingDb,
  rpcNullable,
  type JsonValue,
  type PricingAuditRow,
  type PricingComponentRow,
  type PricingVersionRow,
  type PricingVersionStatus,
} from "@/lib/pricing-api";
import type { PricingInputs, PricingServiceCode } from "@/lib/pricing-engine";
import { toast } from "sonner";

const SERVICE_LABEL: Record<PricingServiceCode, string> = {
  ride: "Normal Ride",
  transport: "Access Transport",
  assisted: "Access Assisted",
  appointment: "Access Appointment",
  extended_journey: "Access Extended Journey",
};

const COMPONENT_LABELS: Record<string, string> = {
  base_fare: "Base fare",
  distance: "Distance",
  transport_minutes: "Transport minutes",
  companion_hours: "Companion hours",
  waiting_hours: "Waiting hours",
  specialist_vehicle: "Specialist vehicle",
  vehicle_days: "Vehicle days",
  driver_days: "Driver days",
  driver_overnights: "Driver overnights",
  companion_days: "Companion days",
  platform_margin: "Platform margin",
};

function scenarioFor(service: PricingServiceCode): PricingInputs {
  switch (service) {
    case "assisted":
      return { distance_km: 10, companion_hours: 2, specialist_vehicle_required: true };
    case "appointment":
      return {
        distance_km: 20,
        companion_hours: 3,
        waiting_hours: 1,
        specialist_vehicle_required: true,
      };
    case "extended_journey":
      return {
        distance_km: 100,
        journey_days: 2,
        driver_overnights: 1,
        companion_days: 2,
        specialist_vehicle_required: true,
      };
    default:
      return { distance_km: 10 };
  }
}

function localDateTime(value: string | null): string {
  if (!value) return "";
  const date = new Date(value);
  const offset = date.getTimezoneOffset() * 60_000;
  return new Date(date.getTime() - offset).toISOString().slice(0, 16);
}

type PricingValidation = {
  is_valid: boolean;
  errors: string[];
  warnings: string[];
  required_components: string[];
};

function asValidation(value: JsonValue | null): PricingValidation | null {
  if (!value || Array.isArray(value) || typeof value !== "object") return null;
  const candidate = value as unknown as PricingValidation;
  return Array.isArray(candidate.errors) && Array.isArray(candidate.warnings) ? candidate : null;
}

function toIso(value: string): string | null {
  return value ? new Date(value).toISOString() : null;
}

export function PricingVersionManager() {
  const [versions, setVersions] = useState<PricingVersionRow[]>([]);
  const [components, setComponents] = useState<PricingComponentRow[]>([]);
  const [audit, setAudit] = useState<PricingAuditRow[]>([]);
  const [service, setService] = useState<PricingServiceCode>("ride");
  const [status, setStatus] = useState<PricingVersionStatus | "all">("all");
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [draftVersion, setDraftVersion] = useState<PricingVersionRow | null>(null);
  const [draftComponents, setDraftComponents] = useState<PricingComponentRow[]>([]);
  const [previewInputs, setPreviewInputs] = useState<PricingInputs>(scenarioFor("ride"));
  const [preview, setPreview] = useState<ReturnType<typeof asCalculationSnapshot>>(null);
  const [compareId, setCompareId] = useState<string>("none");
  const [comparePreview, setComparePreview] =
    useState<ReturnType<typeof asCalculationSnapshot>>(null);
  const [publishConfirmation, setPublishConfirmation] = useState("");
  const [validation, setValidation] = useState<PricingValidation | null>(null);
  const [deleteReason, setDeleteReason] = useState("");
  const [retireReason, setRetireReason] = useState("");
  const [busy, setBusy] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    const [versionResult, componentResult, auditResult] = await Promise.all([
      pricingDb
        .from("pricing_versions")
        .select("*")
        .order("service_code")
        .order("version_number", { ascending: false }),
      pricingDb.from("pricing_components").select("*").order("calculation_order"),
      pricingDb
        .from("pricing_audit_events")
        .select("*")
        .order("created_at", { ascending: false })
        .limit(100),
    ]);
    const loadError = versionResult.error ?? componentResult.error ?? auditResult.error;
    if (loadError) {
      setError(loadError.message);
      setLoading(false);
      return;
    }
    const nextVersions = (versionResult.data ?? []) as unknown as PricingVersionRow[];
    setVersions(nextVersions);
    setComponents((componentResult.data ?? []) as unknown as PricingComponentRow[]);
    setAudit(auditResult.data ?? []);
    setSelectedId((current) => {
      if (current && nextVersions.some((item) => item.id === current)) return current;
      return nextVersions.find((item) => item.service_code === service)?.id ?? null;
    });
    setLoading(false);
  }, [service]);

  useEffect(() => {
    void load();
  }, [load]);

  const filtered = useMemo(
    () =>
      versions.filter(
        (version) =>
          version.service_code === service && (status === "all" || version.status === status),
      ),
    [service, status, versions],
  );

  const selected = versions.find((version) => version.id === selectedId) ?? filtered[0] ?? null;

  useEffect(() => {
    if (!selected) {
      setDraftVersion(null);
      setDraftComponents([]);
      return;
    }
    setSelectedId(selected.id);
    setDraftVersion({ ...selected });
    setDraftComponents(
      components
        .filter((component) => component.pricing_version_id === selected.id)
        .map((component) => ({ ...component })),
    );
    setPreview(null);
    setComparePreview(null);
    setPublishConfirmation("");
    setValidation(null);
    setDeleteReason("");
    setRetireReason("");
  }, [components, selected]);

  useEffect(() => {
    setPreviewInputs(scenarioFor(service));
  }, [service]);

  const createDraft = async (cloneFrom?: PricingVersionRow) => {
    setBusy("create");
    const { error: createError } = await pricingDb.rpc("admin_create_pricing_draft", {
      p_service_code: service,
      p_clone_from_version_id: cloneFrom?.id,
      p_name: `${SERVICE_LABEL[service]} draft`,
      p_effective_from: new Date().toISOString(),
      p_idempotency_key: crypto.randomUUID(),
    });
    setBusy(null);
    if (createError) return toast.error(createError.message);
    toast.success(cloneFrom ? "Pricing version cloned into a draft" : "Pricing draft created");
    await load();
  };

  const updateComponent = (id: string, patch: Partial<PricingComponentRow>) => {
    setDraftComponents((current) =>
      current.map((component) => (component.id === id ? { ...component, ...patch } : component)),
    );
  };

  const saveDraft = async () => {
    if (!draftVersion || draftVersion.status !== "draft") return;
    setBusy("save");
    const payload = draftComponents.map((component) => ({
      component_code: component.component_code,
      customer_label: component.customer_label,
      internal_description: component.internal_description,
      calculation_type: component.calculation_type,
      amount: Number(component.amount),
      minimum_quantity: Number(component.minimum_quantity),
      maximum_quantity:
        component.maximum_quantity == null ? null : Number(component.maximum_quantity),
      applicability_conditions: component.applicability_conditions,
      calculation_order: Number(component.calculation_order),
      customer_visible: component.customer_visible,
      is_active: component.is_active,
    })) as unknown as JsonValue;
    const { error: saveError } = await pricingDb.rpc("admin_save_pricing_draft", {
      p_version_id: draftVersion.id,
      p_name: draftVersion.name,
      p_description: draftVersion.description ?? "",
      p_effective_from: rpcNullable(toIso(localDateTime(draftVersion.effective_from))),
      p_effective_to: rpcNullable(toIso(localDateTime(draftVersion.effective_to))),
      p_is_mock: draftVersion.is_mock,
      p_components: payload,
      p_expected_row_version: draftVersion.row_version,
    });
    setBusy(null);
    if (saveError) return toast.error(saveError.message);
    toast.success("Pricing draft saved");
    setValidation(null);
    await load();
  };

  const runPreview = async (versionId: string, comparison = false) => {
    setBusy(comparison ? "compare" : "preview");
    const { data, error: previewError } = await pricingDb.rpc("admin_pricing_calculate", {
      p_service_code: service,
      p_inputs: previewInputs as unknown as JsonValue,
      p_effective_at: new Date().toISOString(),
      p_pricing_version_id: versionId,
    });
    setBusy(null);
    if (previewError) return toast.error(previewError.message);
    const result = asCalculationSnapshot(data);
    if (comparison) setComparePreview(result);
    else setPreview(result);
  };

  const validateVersion = async () => {
    if (!draftVersion) return;
    setBusy("validate");
    const { data, error: validationError } = await pricingDb.rpc("admin_validate_pricing_version", {
      p_version_id: draftVersion.id,
    });
    setBusy(null);
    if (validationError) return toast.error(validationError.message);
    const result = asValidation(data);
    setValidation(result);
    if (result?.is_valid) toast.success("Pricing draft passed server validation");
    else toast.error("Pricing draft requires correction before publication");
  };

  const deleteDraft = async () => {
    if (!draftVersion || draftVersion.status !== "draft") return;
    setBusy("delete");
    const { error: deleteError } = await pricingDb.rpc("admin_delete_pricing_draft", {
      p_version_id: draftVersion.id,
      p_reason: deleteReason,
      p_expected_row_version: draftVersion.row_version,
    });
    setBusy(null);
    if (deleteError) return toast.error(deleteError.message);
    toast.success("Pricing draft deleted; the audit event was retained");
    setSelectedId(null);
    await load();
  };

  const publish = async () => {
    if (!draftVersion) return;
    setBusy("publish");
    const { error: publishError } = await pricingDb.rpc("admin_publish_pricing_version", {
      p_version_id: draftVersion.id,
      p_expected_row_version: draftVersion.row_version,
      p_confirmation: publishConfirmation,
    });
    setBusy(null);
    if (publishError) return toast.error(publishError.message);
    toast.success("Pricing version published");
    await load();
  };

  const retire = async () => {
    if (!draftVersion) return;
    setBusy("retire");
    const { error: retireError } = await pricingDb.rpc("admin_retire_pricing_version", {
      p_version_id: draftVersion.id,
      p_reason: retireReason,
      p_expected_row_version: draftVersion.row_version,
    });
    setBusy(null);
    if (retireError) return toast.error(retireError.message);
    toast.success("Pricing version retired");
    await load();
  };

  const selectedAudit = audit.filter((event) => event.pricing_version_id === selected?.id);
  const comparableVersions = versions.filter(
    (version) => version.service_code === service && version.id !== selected?.id,
  );

  return (
    <div className="space-y-5">
      <section className="rounded-2xl border border-primary/25 bg-primary/5 p-4 text-sm">
        <div className="flex items-start gap-2">
          <ShieldCheck className="mt-0.5 h-5 w-5 text-primary" />
          <div>
            <p className="font-semibold">Server-authoritative pricing</p>
            <p className="text-muted-foreground">
              Published versions are immutable. Normal Ride and Access Transport remain R20.00 plus
              R13.50/km. Specialised mock versions cannot be published until the mock flag is
              deliberately removed.
            </p>
          </div>
        </div>
      </section>

      <div className="grid gap-3 md:grid-cols-[1fr_180px_auto]">
        <div>
          <Label>Service</Label>
          <Select
            value={service}
            onValueChange={(value) => setService(value as PricingServiceCode)}
          >
            <SelectTrigger>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {Object.entries(SERVICE_LABEL).map(([value, label]) => (
                <SelectItem key={value} value={value}>
                  {label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <div>
          <Label>Status</Label>
          <Select
            value={status}
            onValueChange={(value) => setStatus(value as PricingVersionStatus | "all")}
          >
            <SelectTrigger>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All versions</SelectItem>
              <SelectItem value="draft">Draft</SelectItem>
              <SelectItem value="published">Published</SelectItem>
              <SelectItem value="retired">Retired</SelectItem>
            </SelectContent>
          </Select>
        </div>
        <div className="flex items-end">
          <Button onClick={() => void createDraft()} disabled={busy === "create"}>
            {busy === "create" ? (
              <Loader2 className="mr-2 h-4 w-4 animate-spin" />
            ) : (
              <Plus className="mr-2 h-4 w-4" />
            )}
            New draft
          </Button>
        </div>
      </div>

      {error ? (
        <div className="rounded-2xl border border-destructive/40 bg-destructive/5 p-4 text-sm text-destructive">
          {error}
        </div>
      ) : null}
      {loading ? (
        <div className="rounded-2xl border p-8 text-center text-sm text-muted-foreground">
          <Loader2 className="mx-auto mb-2 h-5 w-5 animate-spin" />
          Loading pricing versions…
        </div>
      ) : null}

      {!loading ? (
        <div className="grid gap-5 xl:grid-cols-[280px_minmax(0,1fr)]">
          <aside className="space-y-2">
            {filtered.length === 0 ? (
              <div className="rounded-2xl border p-4 text-sm text-muted-foreground">
                No versions match this filter.
              </div>
            ) : null}
            {filtered.map((version) => (
              <button
                key={version.id}
                type="button"
                onClick={() => setSelectedId(version.id)}
                className={`w-full rounded-xl border p-3 text-left transition ${selected?.id === version.id ? "border-primary bg-primary/5" : "bg-card hover:bg-secondary/60"}`}
              >
                <div className="flex items-center justify-between gap-2">
                  <span className="font-medium">Version {version.version_number}</span>
                  <Badge
                    variant={
                      version.status === "published"
                        ? "default"
                        : version.status === "draft"
                          ? "secondary"
                          : "outline"
                    }
                  >
                    {version.status}
                  </Badge>
                </div>
                <p className="mt-1 truncate text-sm">{version.name}</p>
                <p className="mt-1 text-xs text-muted-foreground">
                  {version.is_mock ? "Mock draft values" : "Business-approved values"}
                </p>
              </button>
            ))}
          </aside>

          {draftVersion ? (
            <main className="space-y-5">
              <section className="rounded-2xl border bg-card p-4 shadow-sm">
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div>
                    <div className="flex flex-wrap items-center gap-2">
                      <h2 className="text-lg font-semibold">
                        {SERVICE_LABEL[draftVersion.service_code]} · v{draftVersion.version_number}
                      </h2>
                      <Badge variant={draftVersion.is_mock ? "secondary" : "default"}>
                        {draftVersion.is_mock ? "Mock draft" : "Approved values"}
                      </Badge>
                      <Badge variant="outline">{draftVersion.status}</Badge>
                    </div>
                    <p className="mt-1 text-xs text-muted-foreground">
                      Row version {draftVersion.row_version} · created{" "}
                      {new Date(draftVersion.created_at).toLocaleString("en-ZA")}
                    </p>
                  </div>
                  <Button
                    variant="outline"
                    onClick={() => void createDraft(draftVersion)}
                    disabled={busy === "create"}
                  >
                    <Copy className="mr-2 h-4 w-4" /> Clone to draft
                  </Button>
                </div>

                <div className="mt-4 grid gap-3 sm:grid-cols-2">
                  <div>
                    <Label>Name</Label>
                    <Input
                      value={draftVersion.name}
                      disabled={draftVersion.status !== "draft"}
                      onChange={(event) =>
                        setDraftVersion({ ...draftVersion, name: event.target.value })
                      }
                    />
                  </div>
                  <div>
                    <Label>Effective from</Label>
                    <Input
                      type="datetime-local"
                      value={localDateTime(draftVersion.effective_from)}
                      disabled={draftVersion.status !== "draft"}
                      onChange={(event) =>
                        setDraftVersion({
                          ...draftVersion,
                          effective_from: toIso(event.target.value),
                        })
                      }
                    />
                  </div>
                  <div>
                    <Label>Effective to (optional)</Label>
                    <Input
                      type="datetime-local"
                      value={localDateTime(draftVersion.effective_to)}
                      disabled={draftVersion.status !== "draft"}
                      onChange={(event) =>
                        setDraftVersion({
                          ...draftVersion,
                          effective_to: toIso(event.target.value),
                        })
                      }
                    />
                  </div>
                  <div className="sm:col-span-2">
                    <Label>Internal description</Label>
                    <Textarea
                      value={draftVersion.description ?? ""}
                      disabled={draftVersion.status !== "draft"}
                      onChange={(event) =>
                        setDraftVersion({ ...draftVersion, description: event.target.value })
                      }
                    />
                  </div>
                </div>

                <label className="mt-3 flex items-center gap-2 text-sm">
                  <Switch
                    checked={draftVersion.is_mock}
                    disabled={draftVersion.status !== "draft"}
                    onCheckedChange={(checked) =>
                      setDraftVersion({ ...draftVersion, is_mock: checked })
                    }
                  />
                  Mark this version as mock draft data
                </label>
              </section>

              <section className="rounded-2xl border bg-card p-4 shadow-sm">
                <div className="mb-3 flex items-center justify-between">
                  <h3 className="font-semibold">Calculation components</h3>
                  {draftVersion.status === "draft" ? (
                    <Button size="sm" onClick={() => void saveDraft()} disabled={busy === "save"}>
                      {busy === "save" ? (
                        <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                      ) : (
                        <Save className="mr-2 h-4 w-4" />
                      )}
                      Save draft
                    </Button>
                  ) : null}
                </div>
                <div className="space-y-3">
                  {draftComponents.map((component) => (
                    <div
                      key={component.id}
                      className="grid gap-3 rounded-xl border bg-background/50 p-3 lg:grid-cols-[1.2fr_160px_160px_120px_auto]"
                    >
                      <div>
                        <Label>
                          {COMPONENT_LABELS[component.component_code] ?? component.component_code}
                        </Label>
                        <Input
                          value={component.customer_label}
                          disabled={draftVersion.status !== "draft"}
                          onChange={(event) =>
                            updateComponent(component.id, { customer_label: event.target.value })
                          }
                        />
                      </div>
                      <div>
                        <Label>Rate</Label>
                        <Input
                          type="number"
                          min="0"
                          step="0.01"
                          value={Number(component.amount)}
                          disabled={draftVersion.status !== "draft"}
                          onChange={(event) =>
                            updateComponent(component.id, { amount: Number(event.target.value) })
                          }
                        />
                      </div>
                      <div>
                        <Label>Minimum quantity</Label>
                        <Input
                          type="number"
                          min="0"
                          step="0.25"
                          value={Number(component.minimum_quantity)}
                          disabled={draftVersion.status !== "draft"}
                          onChange={(event) =>
                            updateComponent(component.id, {
                              minimum_quantity: Number(event.target.value),
                            })
                          }
                        />
                      </div>
                      <div>
                        <Label>Type</Label>
                        <p className="mt-2 text-sm text-muted-foreground">
                          {component.calculation_type}
                        </p>
                      </div>
                      <div className="flex flex-col justify-end gap-2 text-xs">
                        <label className="flex items-center gap-2">
                          <Switch
                            checked={component.is_active}
                            disabled={draftVersion.status !== "draft"}
                            onCheckedChange={(checked) =>
                              updateComponent(component.id, { is_active: checked })
                            }
                          />
                          Active
                        </label>
                        <label className="flex items-center gap-2">
                          <Switch
                            checked={component.customer_visible}
                            disabled={draftVersion.status !== "draft"}
                            onCheckedChange={(checked) =>
                              updateComponent(component.id, { customer_visible: checked })
                            }
                          />
                          Customer visible
                        </label>
                      </div>
                    </div>
                  ))}
                </div>
              </section>

              <section className="rounded-2xl border bg-card p-4 shadow-sm">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <h3 className="flex items-center gap-2 font-semibold">
                    <Calculator className="h-4 w-4" /> Server calculation preview
                  </h3>
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() => void runPreview(draftVersion.id)}
                    disabled={busy === "preview"}
                  >
                    {busy === "preview" ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
                    Calculate
                  </Button>
                </div>
                <div className="mt-3 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
                  {Object.entries(previewInputs)
                    .filter(([, value]) => typeof value === "number")
                    .map(([key, value]) => (
                      <div key={key}>
                        <Label>{key.replaceAll("_", " ")}</Label>
                        <Input
                          type="number"
                          min="0"
                          step="0.25"
                          value={Number(value)}
                          onChange={(event) =>
                            setPreviewInputs({
                              ...previewInputs,
                              [key]: Number(event.target.value),
                            })
                          }
                        />
                      </div>
                    ))}
                </div>
                {preview ? (
                  <div className="mt-4 rounded-xl bg-secondary p-3 text-sm">
                    {preview.warnings.length ? (
                      <p className="mb-2 text-destructive">{preview.warnings.join(" · ")}</p>
                    ) : null}
                    {preview.lines
                      .filter((line) => line.customer_visible)
                      .map((line) => (
                        <div key={line.component_code} className="flex justify-between gap-3">
                          <span>
                            {line.label} × {line.quantity}
                          </span>
                          <span>{formatZAR(Number(line.line_total))}</span>
                        </div>
                      ))}
                    <div className="mt-2 flex justify-between border-t pt-2 font-semibold">
                      <span>Total</span>
                      <span>{formatZAR(Number(preview.total))}</span>
                    </div>
                    {preview.margin_amount > 0 ? (
                      <p className="mt-1 text-xs text-muted-foreground">
                        Internal margin amount is visible to administrators only:{" "}
                        {formatZAR(Number(preview.margin_amount))}
                      </p>
                    ) : null}
                  </div>
                ) : null}

                {comparableVersions.length ? (
                  <div className="mt-4 grid gap-2 sm:grid-cols-[1fr_auto]">
                    <Select value={compareId} onValueChange={setCompareId}>
                      <SelectTrigger>
                        <SelectValue placeholder="Compare with another version" />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="none">Choose comparison</SelectItem>
                        {comparableVersions.map((version) => (
                          <SelectItem key={version.id} value={version.id}>
                            Version {version.version_number} · {version.status}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                    <Button
                      variant="outline"
                      disabled={compareId === "none" || busy === "compare"}
                      onClick={() => void runPreview(compareId, true)}
                    >
                      Compare
                    </Button>
                  </div>
                ) : null}
                {comparePreview ? (
                  <p className="mt-2 text-sm">
                    Comparison total: <strong>{formatZAR(Number(comparePreview.total))}</strong> ·
                    Difference{" "}
                    {formatZAR(Number(comparePreview.total) - Number(preview?.total ?? 0))}
                  </p>
                ) : null}
              </section>

              {draftVersion.status === "draft" ? (
                <section className="rounded-2xl border bg-card p-4">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <div>
                      <h3 className="font-semibold">Server validation</h3>
                      <p className="text-sm text-muted-foreground">
                        Required components, mock status and effective-window overlap are checked in
                        the database.
                      </p>
                    </div>
                    <Button
                      variant="outline"
                      onClick={() => void validateVersion()}
                      disabled={busy === "validate"}
                    >
                      {busy === "validate" ? (
                        <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                      ) : null}
                      Validate draft
                    </Button>
                  </div>
                  {validation ? (
                    <div
                      className={`mt-3 rounded-xl p-3 text-sm ${validation.is_valid ? "bg-primary/5" : "bg-destructive/5"}`}
                    >
                      <p className="font-medium">
                        {validation.is_valid ? "Ready to publish" : "Not ready to publish"}
                      </p>
                      {validation.errors.map((message) => (
                        <p key={message} className="text-destructive">
                          {message}
                        </p>
                      ))}
                      {validation.warnings.map((message) => (
                        <p key={message} className="text-muted-foreground">
                          {message}
                        </p>
                      ))}
                    </div>
                  ) : null}
                </section>
              ) : null}

              {draftVersion.status === "draft" ? (
                <section className="rounded-2xl border border-primary/25 bg-primary/5 p-4">
                  <h3 className="flex items-center gap-2 font-semibold">
                    <Send className="h-4 w-4" /> Publish version
                  </h3>
                  <p className="mt-1 text-sm text-muted-foreground">
                    Publishing makes this version immutable and active from its effective date. Mock
                    versions are blocked.
                  </p>
                  <div className="mt-3 flex flex-col gap-2 sm:flex-row">
                    <Input
                      placeholder="Type PUBLISH"
                      value={publishConfirmation}
                      onChange={(event) => setPublishConfirmation(event.target.value)}
                    />
                    <Button
                      onClick={() => void publish()}
                      disabled={
                        busy === "publish" ||
                        publishConfirmation !== "PUBLISH" ||
                        draftVersion.is_mock ||
                        !validation?.is_valid
                      }
                    >
                      {busy === "publish" ? (
                        <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                      ) : null}
                      Publish
                    </Button>
                  </div>
                </section>
              ) : null}

              {draftVersion.status === "draft" ? (
                <section className="rounded-2xl border border-destructive/25 p-4">
                  <h3 className="font-semibold">Delete draft</h3>
                  <p className="mt-1 text-sm text-muted-foreground">
                    Only drafts may be deleted. The deletion reason remains in the audit history.
                  </p>
                  <div className="mt-3 flex flex-col gap-2 sm:flex-row">
                    <Input
                      placeholder="Mandatory deletion reason"
                      value={deleteReason}
                      onChange={(event) => setDeleteReason(event.target.value)}
                    />
                    <Button
                      variant="destructive"
                      onClick={() => void deleteDraft()}
                      disabled={busy === "delete" || !deleteReason.trim()}
                    >
                      Delete draft
                    </Button>
                  </div>
                </section>
              ) : null}

              {draftVersion.status === "published" ? (
                <section className="rounded-2xl border p-4">
                  <h3 className="font-semibold">Retire published version</h3>
                  <div className="mt-3 flex flex-col gap-2 sm:flex-row">
                    <Input
                      placeholder="Mandatory retirement reason"
                      value={retireReason}
                      onChange={(event) => setRetireReason(event.target.value)}
                    />
                    <Button
                      variant="destructive"
                      onClick={() => void retire()}
                      disabled={busy === "retire" || !retireReason.trim()}
                    >
                      Retire
                    </Button>
                  </div>
                </section>
              ) : null}

              <section className="rounded-2xl border bg-card p-4">
                <h3 className="flex items-center gap-2 font-semibold">
                  <History className="h-4 w-4" /> Audit history
                </h3>
                <div className="mt-3 space-y-2 text-sm">
                  {selectedAudit.length === 0 ? (
                    <p className="text-muted-foreground">No events recorded yet.</p>
                  ) : (
                    selectedAudit.map((event) => (
                      <div key={event.id} className="rounded-lg bg-secondary/60 p-2">
                        <div className="flex justify-between gap-2">
                          <span className="font-medium">
                            {event.event_type.replaceAll("_", " ")}
                          </span>
                          <span className="text-xs text-muted-foreground">
                            {new Date(event.created_at).toLocaleString("en-ZA")}
                          </span>
                        </div>
                        {event.reason ? (
                          <p className="text-xs text-muted-foreground">{event.reason}</p>
                        ) : null}
                      </div>
                    ))
                  )}
                </div>
              </section>
            </main>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
