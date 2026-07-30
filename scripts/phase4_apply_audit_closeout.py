from pathlib import Path


def replace_once(path: Path, old: str, new: str) -> None:
    text = path.read_text()
    count = text.count(old)
    if count != 1:
        raise RuntimeError(f"{path}: expected one match, found {count}: {old[:120]!r}")
    path.write_text(text.replace(old, new, 1))


def replace_count(path: Path, old: str, new: str, expected: int) -> None:
    text = path.read_text()
    count = text.count(old)
    if count != expected:
        raise RuntimeError(f"{path}: expected {expected} matches, found {count}: {old[:120]!r}")
    path.write_text(text.replace(old, new))


closeout = Path("supabase/migrations/20260730234500_phase4_pricing_security_closeout.sql")
replace_count(
    closeout,
    "  RETURN COALESCE(NEW, OLD);",
    "  IF TG_OP = 'DELETE' THEN RETURN OLD; END IF;\n  RETURN NEW;",
    3,
)

estimates = Path("supabase/migrations/20260730233500_phase4_server_estimates.sql")
replace_once(
    estimates,
    "    COALESCE(v_ride.scheduled_at, v_ride.created_at), NULL\n  );",
    "    COALESCE(v_ride.scheduled_at, v_ride.created_at), v_ride.pricing_version_id\n  );",
)

api = Path("src/lib/pricing-api.ts")
replace_once(api, "      pricing_calculate: {", "      admin_pricing_calculate: {")
replace_once(
    api,
    "          p_effective_from: string;\n          p_is_mock: boolean;",
    "          p_effective_from: string | null;\n          p_effective_to: string | null;\n          p_is_mock: boolean;",
)
replace_once(
    api,
    '''      passenger_decline_service_quote: {
        Args: { p_quote_id: string; p_expected_row_version: number; p_reason?: string };
        Returns: JsonValue;
      };''',
    '''      passenger_decline_service_quote: {
        Args: { p_quote_id: string; p_expected_row_version: number; p_reason?: string };
        Returns: JsonValue;
      };
      admin_set_quote_deposit: {
        Args: {
          p_quote_id: string;
          p_required: boolean;
          p_amount: number;
          p_reason: string;
          p_expected_row_version: number;
        };
        Returns: JsonValue;
      };
      admin_expire_service_quotes: { Args: Record<string, never>; Returns: number };''',
)

manager = Path("src/components/pricing/PricingVersionManager.tsx")
replace_once(
    manager,
    '''function toIso(value: string): string {
  return value ? new Date(value).toISOString() : "";
}''',
    '''function toIso(value: string): string | null {
  return value ? new Date(value).toISOString() : null;
}''',
)
replace_once(
    manager,
    "  }, [components, selected?.id]);",
    "  }, [components, selected]);",
)
replace_once(
    manager,
    "      p_effective_from: toIso(localDateTime(draftVersion.effective_from)),\n      p_is_mock: draftVersion.is_mock,",
    "      p_effective_from: toIso(localDateTime(draftVersion.effective_from)),\n      p_effective_to: toIso(localDateTime(draftVersion.effective_to)),\n      p_is_mock: draftVersion.is_mock,",
)
replace_once(manager, 'pricingDb.rpc("pricing_calculate", {', 'pricingDb.rpc("admin_pricing_calculate", {')
replace_once(
    manager,
    '''                  <div className="sm:col-span-2">
                    <Label>Internal description</Label>''',
    '''                  <div>
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
                    <Label>Internal description</Label>''',
)

admin_quote = Path("src/routes/app.admin.bookings.$bookingId.quote.tsx")
replace_once(
    admin_quote,
    'import { Textarea } from "@/components/ui/textarea";',
    'import { Textarea } from "@/components/ui/textarea";\nimport { Switch } from "@/components/ui/switch";',
)
replace_once(
    admin_quote,
    "  final_total: number;\n  currency: string;",
    "  final_total: number;\n  deposit_required: boolean;\n  deposit_amount_snapshot: number;\n  currency: string;",
)
replace_once(
    admin_quote,
    '  const [overrideReason, setOverrideReason] = useState("");\n  const [busy, setBusy] = useState<string | null>(null);',
    '''  const [overrideReason, setOverrideReason] = useState("");
  const [depositRequired, setDepositRequired] = useState(false);
  const [depositAmount, setDepositAmount] = useState(0);
  const [depositReason, setDepositReason] = useState("");
  const [busy, setBusy] = useState<string | null>(null);''',
)
replace_once(
    admin_quote,
    '''  const selectedQuote = useMemo(
    () =>
      workspace?.quotes.find((quote) => quote.status === "draft" && !quote.sent_at) ??
      workspace?.quotes[0] ??
      null,
    [workspace],
  );''',
    '''  const selectedQuote = useMemo(
    () =>
      workspace?.quotes.find((quote) => quote.status === "draft" && !quote.sent_at) ??
      workspace?.quotes[0] ??
      null,
    [workspace],
  );

  useEffect(() => {
    setDepositRequired(selectedQuote?.deposit_required ?? false);
    setDepositAmount(Number(selectedQuote?.deposit_amount_snapshot ?? 0));
    setDepositReason("");
  }, [selectedQuote?.id, selectedQuote?.deposit_amount_snapshot, selectedQuote?.deposit_required]);''',
)
replace_once(
    admin_quote,
    '''  const sendQuote = async () => {
    if (!selectedQuote) return;''',
    '''  const saveDeposit = async () => {
    if (!selectedQuote) return;
    setBusy("deposit");
    const { error: depositError } = await pricingDb.rpc("admin_set_quote_deposit", {
      p_quote_id: selectedQuote.id,
      p_required: depositRequired,
      p_amount: Number(depositAmount),
      p_reason: depositReason,
      p_expected_row_version: selectedQuote.row_version,
    });
    setBusy(null);
    if (depositError) return toast.error(depositError.message);
    toast.success("Quote deposit terms updated");
    await load();
  };

  const sendQuote = async () => {
    if (!selectedQuote) return;''',
)
replace_once(
    admin_quote,
    '''              <div className="mt-4 flex justify-end">
                <Button onClick={() => void sendQuote()} disabled={busy === "send"}>''',
    '''              <div className="mt-4 grid gap-3 rounded-xl border p-3 md:grid-cols-[auto_160px_1fr_auto]">
                <label className="flex items-center gap-2 text-sm">
                  <Switch checked={depositRequired} onCheckedChange={setDepositRequired} />
                  Deposit required
                </label>
                <div>
                  <Label>Deposit amount</Label>
                  <Input
                    type="number"
                    min="0"
                    step="0.01"
                    value={depositAmount}
                    disabled={!depositRequired}
                    onChange={(event) => setDepositAmount(Number(event.target.value))}
                  />
                </div>
                <div>
                  <Label>Mandatory reason</Label>
                  <Input value={depositReason} onChange={(event) => setDepositReason(event.target.value)} />
                </div>
                <div className="flex items-end">
                  <Button
                    variant="outline"
                    disabled={!depositReason.trim() || busy === "deposit"}
                    onClick={() => void saveDeposit()}
                  >
                    Save deposit terms
                  </Button>
                </div>
              </div>
              <div className="mt-4 flex justify-end">
                <Button onClick={() => void sendQuote()} disabled={busy === "send"}>''',
)

bell = Path("src/components/NotificationBell.tsx")
replace_once(
    bell,
    '''type Notification = Database["public"]["Tables"]["notifications"]["Row"] & {
  support_ticket_id?: string | null;
};''',
    '''type Notification = Database["public"]["Tables"]["notifications"]["Row"] & {
  support_ticket_id?: string | null;
  service_booking_id?: string | null;
};''',
)
replace_once(
    bell,
    '''                } else if (notification.ride_id) {
                  destination = (''',
    '''                } else if (notification.service_booking_id) {
                  destination = isAdmin ? (
                    <Link
                      to="/app/admin/bookings/$bookingId/quote"
                      params={{ bookingId: notification.service_booking_id }}
                      onClick={() => setOpen(false)}
                    >
                      {inner}
                    </Link>
                  ) : (
                    <Link
                      to="/app/passenger/bookings/$bookingId/quote"
                      params={{ bookingId: notification.service_booking_id }}
                      onClick={() => setOpen(false)}
                    >
                      {inner}
                    </Link>
                  );
                } else if (notification.ride_id) {
                  destination = (''',
)

assisted = Path("src/routes/app.passenger.book.assisted.tsx")
replace_once(assisted, 'import { estimatePrice, formatZAR } from "@/lib/pricing";\n', '')
replace_once(assisted, "  const transportEstimate = distanceKm != null ? estimatePrice(distanceKm) : null;\n", '')
replace_once(assisted, "          estimated_total: transportEstimate,", "          estimated_total: null,")
replace_once(assisted, "          estimatedTransport: transportEstimate,\n", '')
replace_once(
    assisted,
    '<span className="font-semibold">{transportEstimate != null ? formatZAR(transportEstimate) : "—"}</span>',
    '<span className="font-semibold">Personalised quote</span>',
)
replace_once(
    assisted,
    "This is the transport estimate only. Our team will send you a quote for the assistance support.",
    "Specialised rates remain unpublished. Our team will calculate and send a personalised quote after reviewing the route and assistance requirements.",
)

appointment = Path("src/routes/app.passenger.book.appointment.tsx")
replace_once(appointment, "    let weekAnchor = new Date(start);", "    const weekAnchor = new Date(start);")
replace_once(
    appointment,
    '  const apptDate = apptLocal ? new Date(apptLocal) : null;',
    '  const apptDate = useMemo(() => (apptLocal ? new Date(apptLocal) : null), [apptLocal]);',
)
replace_once(
    appointment,
    '''  const recurrenceRule: RecurrenceRule | null =
    pattern === "recurring"
      ? {
          frequency,
          interval,
          weekdays: frequency === "monthly" ? undefined : weekdays.length ? weekdays : (apptDate ? [apptDate.getDay()] : []),
          end_date: endMode === "date" && recurEnd ? recurEnd : null,
          occurrences: endMode === "count" ? Math.max(1, Math.min(MAX_GENERATED_OCCURRENCES, occurrences)) : null,
        }
      : null;''',
    '''  const recurrenceRule = useMemo<RecurrenceRule | null>(
    () =>
      pattern === "recurring"
        ? {
            frequency,
            interval,
            weekdays:
              frequency === "monthly"
                ? undefined
                : weekdays.length
                  ? weekdays
                  : apptDate
                    ? [apptDate.getDay()]
                    : [],
            end_date: endMode === "date" && recurEnd ? recurEnd : null,
            occurrences:
              endMode === "count"
                ? Math.max(1, Math.min(MAX_GENERATED_OCCURRENCES, occurrences))
                : null,
          }
        : null,
    [apptDate, endMode, frequency, interval, occurrences, pattern, recurEnd, weekdays],
  );''',
)
replace_once(appointment, 'import { estimatePrice, formatZAR } from "@/lib/pricing";\n', '')
replace_once(appointment, "  const transportEstimate = outboundKm != null ? estimatePrice(outboundKm) : null;\n", '')
replace_once(appointment, "        estimated_total: transportEstimate,", "        estimated_total: null,")
replace_once(appointment, "      estimatedTransport: transportEstimate,\n", '')
replace_once(
    appointment,
    '<span className="font-semibold">{transportEstimate != null ? formatZAR(transportEstimate) : "—"}</span>',
    '<span className="font-semibold">Personalised quote</span>',
)
replace_once(
    appointment,
    "Transport estimate covers the outbound leg only. Our team will send a full quote (return ride, waiting time, support) for the chosen journey option.",
    "Appointment pricing remains unpublished. Our team will calculate the complete route, waiting and support requirements before sending a personalised quote.",
)

for path in (assisted, appointment):
    if "estimatePrice(" in path.read_text() or "transportEstimate" in path.read_text():
        raise RuntimeError(f"{path}: specialised browser estimate remains")

print("Phase 4 completed-diff closeout applied")
