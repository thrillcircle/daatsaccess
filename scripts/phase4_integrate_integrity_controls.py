from pathlib import Path


def replace_once(path: Path, old: str, new: str) -> None:
    text = path.read_text()
    count = text.count(old)
    if count != 1:
        raise RuntimeError(f"{path}: expected one match, found {count}: {old[:120]!r}")
    path.write_text(text.replace(old, new, 1))


api = Path("src/lib/pricing-api.ts")
replace_once(
    api,
    '''      admin_publish_pricing_version: {
        Args: { p_version_id: string; p_expected_row_version: number; p_confirmation: string };
        Returns: JsonValue;
      };''',
    '''      admin_validate_pricing_version: {
        Args: { p_version_id: string };
        Returns: JsonValue;
      };
      admin_publish_pricing_version: {
        Args: { p_version_id: string; p_expected_row_version: number; p_confirmation: string };
        Returns: JsonValue;
      };
      admin_delete_pricing_draft: {
        Args: { p_version_id: string; p_reason: string; p_expected_row_version: number };
        Returns: JsonValue;
      };''',
)
replace_once(
    api,
    '''      admin_apply_quote_override: {
        Args: {
          p_quote_id: string;
          p_adjustment: number;
          p_reason: string;
          p_expected_row_version: number;
        };
        Returns: JsonValue;
      };''',
    '''      admin_apply_quote_override: {
        Args: {
          p_quote_id: string;
          p_adjustment: number;
          p_reason: string;
          p_expected_row_version: number;
        };
        Returns: JsonValue;
      };
      admin_recalculate_service_quote: {
        Args: {
          p_quote_id: string;
          p_inputs: JsonValue;
          p_valid_until: string;
          p_expected_row_version: number;
          p_idempotency_key?: string;
        };
        Returns: JsonValue;
      };
      admin_cancel_service_quote: {
        Args: {
          p_quote_id: string;
          p_reason: string;
          p_expected_row_version: number;
          p_idempotency_key?: string;
        };
        Returns: JsonValue;
      };''',
)

manager = Path("src/components/pricing/PricingVersionManager.tsx")
replace_once(
    manager,
    '''function toIso(value: string): string | null {
  return value ? new Date(value).toISOString() : null;
}
''',
    '''type PricingValidation = {
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
''',
)
replace_once(
    manager,
    '''  const [publishConfirmation, setPublishConfirmation] = useState("");
  const [retireReason, setRetireReason] = useState("");''',
    '''  const [publishConfirmation, setPublishConfirmation] = useState("");
  const [validation, setValidation] = useState<PricingValidation | null>(null);
  const [deleteReason, setDeleteReason] = useState("");
  const [retireReason, setRetireReason] = useState("");''',
)
replace_once(
    manager,
    '''    setPublishConfirmation("");
    setRetireReason("");''',
    '''    setPublishConfirmation("");
    setValidation(null);
    setDeleteReason("");
    setRetireReason("");''',
)
replace_once(
    manager,
    '''    toast.success("Pricing draft saved");
    await load();''',
    '''    toast.success("Pricing draft saved");
    setValidation(null);
    await load();''',
)
replace_once(
    manager,
    '''  const publish = async () => {
    if (!draftVersion) return;''',
    '''  const validateVersion = async () => {
    if (!draftVersion) return;
    setBusy("validate");
    const { data, error: validationError } = await pricingDb.rpc(
      "admin_validate_pricing_version",
      { p_version_id: draftVersion.id },
    );
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
    if (!draftVersion) return;''',
)
replace_once(
    manager,
    '''              {draftVersion.status === "draft" ? (
                <section className="rounded-2xl border border-primary/25 bg-primary/5 p-4">''',
    '''              {draftVersion.status === "draft" ? (
                <section className="rounded-2xl border bg-card p-4">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <div>
                      <h3 className="font-semibold">Server validation</h3>
                      <p className="text-sm text-muted-foreground">
                        Required components, mock status and effective-window overlap are checked in the database.
                      </p>
                    </div>
                    <Button
                      variant="outline"
                      onClick={() => void validateVersion()}
                      disabled={busy === "validate"}
                    >
                      {busy === "validate" ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
                      Validate draft
                    </Button>
                  </div>
                  {validation ? (
                    <div className={`mt-3 rounded-xl p-3 text-sm ${validation.is_valid ? "bg-primary/5" : "bg-destructive/5"}`}>
                      <p className="font-medium">{validation.is_valid ? "Ready to publish" : "Not ready to publish"}</p>
                      {validation.errors.map((message) => <p key={message} className="text-destructive">{message}</p>)}
                      {validation.warnings.map((message) => <p key={message} className="text-muted-foreground">{message}</p>)}
                    </div>
                  ) : null}
                </section>
              ) : null}

              {draftVersion.status === "draft" ? (
                <section className="rounded-2xl border border-primary/25 bg-primary/5 p-4">''',
)
replace_once(
    manager,
    '''                        publishConfirmation !== "PUBLISH" ||
                        draftVersion.is_mock''',
    '''                        publishConfirmation !== "PUBLISH" ||
                        draftVersion.is_mock ||
                        !validation?.is_valid''',
)
replace_once(
    manager,
    '''              {draftVersion.status === "published" ? (
                <section className="rounded-2xl border p-4">''',
    '''              {draftVersion.status === "draft" ? (
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
                <section className="rounded-2xl border p-4">''',
)

admin_quote = Path("src/routes/app.admin.bookings.$bookingId.quote.tsx")
replace_once(
    admin_quote,
    '''  const [depositReason, setDepositReason] = useState("");
  const [busy, setBusy] = useState<string | null>(null);''',
    '''  const [depositReason, setDepositReason] = useState("");
  const [cancelReason, setCancelReason] = useState("");
  const [busy, setBusy] = useState<string | null>(null);''',
)
replace_once(
    admin_quote,
    '''  const applyOverride = async () => {
    if (!selectedQuote) return;''',
    '''  const recalculate = async () => {
    if (!selectedQuote || selectedQuote.status !== "draft") return;
    setBusy("recalculate");
    const { error: recalculateError } = await pricingDb.rpc(
      "admin_recalculate_service_quote",
      {
        p_quote_id: selectedQuote.id,
        p_inputs: inputs as unknown as JsonValue,
        p_valid_until: new Date(validUntil).toISOString(),
        p_expected_row_version: selectedQuote.row_version,
        p_idempotency_key: crypto.randomUUID(),
      },
    );
    setBusy(null);
    if (recalculateError) return toast.error(recalculateError.message);
    toast.success("Draft quote recalculated using its immutable pricing version");
    await load();
  };

  const cancelQuote = async () => {
    if (!selectedQuote) return;
    setBusy("cancel");
    const { error: cancelError } = await pricingDb.rpc("admin_cancel_service_quote", {
      p_quote_id: selectedQuote.id,
      p_reason: cancelReason,
      p_expected_row_version: selectedQuote.row_version,
      p_idempotency_key: crypto.randomUUID(),
    });
    setBusy(null);
    if (cancelError) return toast.error(cancelError.message);
    toast.success("Quote revision cancelled");
    setCancelReason("");
    await load();
  };

  const applyOverride = async () => {
    if (!selectedQuote) return;''',
)
replace_once(
    admin_quote,
    '''              <Button onClick={() => void generate()} disabled={busy === "generate"}>
                {busy === "generate" ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
                Generate revision
              </Button>''',
    '''              <div className="flex flex-wrap gap-2">
                {selectedQuote?.status === "draft" ? (
                  <Button
                    variant="outline"
                    onClick={() => void recalculate()}
                    disabled={busy === "recalculate"}
                  >
                    {busy === "recalculate" ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
                    Recalculate draft
                  </Button>
                ) : null}
                <Button onClick={() => void generate()} disabled={busy === "generate"}>
                  {busy === "generate" ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
                  Generate revision
                </Button>
              </div>''',
)
replace_once(
    admin_quote,
    '''          <section className="rounded-2xl border bg-card p-4 shadow-sm">
            <h3 className="flex items-center gap-2 font-semibold">
              <History className="h-4 w-4" /> Revision history''',
    '''          {selectedQuote && !selectedQuote.accepted_at && !selectedQuote.cancelled_at ? (
            <section className="rounded-2xl border border-destructive/25 p-4">
              <h3 className="font-semibold">Cancel current quote revision</h3>
              <div className="mt-3 flex flex-col gap-2 sm:flex-row">
                <Input
                  placeholder="Mandatory cancellation reason"
                  value={cancelReason}
                  onChange={(event) => setCancelReason(event.target.value)}
                />
                <Button
                  variant="destructive"
                  onClick={() => void cancelQuote()}
                  disabled={busy === "cancel" || !cancelReason.trim()}
                >
                  Cancel revision
                </Button>
              </div>
            </section>
          ) : null}

          <section className="rounded-2xl border bg-card p-4 shadow-sm">
            <h3 className="flex items-center gap-2 font-semibold">
              <History className="h-4 w-4" /> Revision history''',
)

passenger = Path("src/routes/app.passenger.bookings.$bookingId.quote.tsx")
replace_once(
    passenger,
    '''    const { error: acceptError } = await pricingDb.rpc("passenger_accept_service_quote", {''',
    '''    const { data, error: acceptError } = await pricingDb.rpc("passenger_accept_service_quote", {''',
)
replace_once(
    passenger,
    '''    if (acceptError) return toast.error(acceptError.message);
    toast.success("Quote accepted");''',
    '''    if (acceptError) return toast.error(acceptError.message);
    const outcome = data as unknown as { accepted?: boolean; reason?: string };
    if (outcome.accepted === false) {
      toast.error(outcome.reason === "expired" ? "This quote has expired" : "The quote was not accepted");
      await load();
      return;
    }
    toast.success("Quote accepted");''',
)
replace_once(
    passenger,
    '''    const { error: declineError } = await pricingDb.rpc("passenger_decline_service_quote", {''',
    '''    const { data, error: declineError } = await pricingDb.rpc("passenger_decline_service_quote", {''',
)
replace_once(
    passenger,
    '''    if (declineError) return toast.error(declineError.message);
    toast.success("Quote declined. Access can prepare a revised quote.");''',
    '''    if (declineError) return toast.error(declineError.message);
    const outcome = data as unknown as { declined?: boolean; reason?: string };
    if (outcome.declined === false) {
      toast.error(outcome.reason === "expired" ? "This quote has expired" : "The quote was not declined");
      await load();
      return;
    }
    toast.success("Quote declined. Access can prepare a revised quote.");''',
)

migration_test = Path("src/lib/pricing-migrations.test.ts")
replace_once(
    migration_test,
    '''const legacyPricing = migration("20260730173000_phase1_service_pricing_rules.sql");
const foundation = migration("20260730231500_phase4_pricing_quotations.sql");''',
    '''const legacyPricing = migration("20260730173000_phase1_service_pricing_rules.sql");
const legacyReconciliation = migration("20260730231400_phase4_legacy_quote_reconciliation.sql");
const quoteStatuses = migration("20260730231450_phase4_quote_status_values.sql");
const foundation = migration("20260730231500_phase4_pricing_quotations.sql");''',
)
replace_once(
    migration_test,
    '''const security = migration("20260730234500_phase4_pricing_security_closeout.sql");''',
    '''const security = migration("20260730234500_phase4_pricing_security_closeout.sql");
const integrity = migration("20260730234700_phase4_integrity_hardening.sql");''',
)
replace_once(
    migration_test,
    '''  it("keeps mock specialised pricing from being published", () => {''',
    '''  it("reconciles legacy quote revisions and lifecycle before unique constraints", () => {
    expect(legacyReconciliation).toContain("row_number() OVER");
    expect(legacyReconciliation).toContain("superseded_by_quote_id");
    expect(quoteStatuses).toContain("ADD VALUE IF NOT EXISTS 'superseded'");
    expect(quoteStatuses).toContain("ADD VALUE IF NOT EXISTS 'cancelled'");
  });

  it("keeps mock specialised pricing from being published", () => {''',
)
replace_once(
    migration_test,
    '''  it("supports quote expiry, deposits and linked notifications", () => {
    expect(security).toContain("CREATE OR REPLACE FUNCTION public.pricing_expire_due_quotes");
    expect(security).toContain("CREATE OR REPLACE FUNCTION public.admin_set_quote_deposit");
    expect(security).toContain("CREATE OR REPLACE FUNCTION public.notify_quote_sent");
  });''',
    '''  it("supports quote expiry, deposits and linked notifications", () => {
    expect(security).toContain("CREATE OR REPLACE FUNCTION public.pricing_expire_due_quotes");
    expect(security).toContain("CREATE OR REPLACE FUNCTION public.admin_set_quote_deposit");
    expect(security).toContain("CREATE OR REPLACE FUNCTION public.notify_quote_sent");
  });

  it("validates publications and protects authoritative booking totals", () => {
    expect(integrity).toContain("CREATE OR REPLACE FUNCTION public.admin_validate_pricing_version");
    expect(integrity).toContain("pricing_validate_version_internal");
    expect(integrity).toContain("Booking pricing and deposit fields are server-authoritative");
    expect(integrity).toContain("REVOKE INSERT, UPDATE, DELETE ON public.service_pricing_rules");
  });

  it("supports draft recalculation, cancellation and committed expiry outcomes", () => {
    expect(integrity).toContain("CREATE OR REPLACE FUNCTION public.admin_recalculate_service_quote");
    expect(integrity).toContain("CREATE OR REPLACE FUNCTION public.admin_cancel_service_quote");
    expect(integrity).toContain("'accepted', false, 'reason', 'expired'");
    expect(integrity).toContain("'declined', false, 'reason', 'expired'");
  });''',
)

print("Phase 4 final integrity controls applied")
