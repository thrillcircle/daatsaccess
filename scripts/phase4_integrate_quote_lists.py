from pathlib import Path


def replace_once(path: Path, old: str, new: str) -> None:
    text = path.read_text()
    count = text.count(old)
    if count != 1:
        raise RuntimeError(f"{path}: expected one source match, found {count}: {old[:100]!r}")
    path.write_text(text.replace(old, new, 1))


def replace_between(path: Path, start: str, end: str, replacement: str) -> None:
    text = path.read_text()
    start_index = text.find(start)
    if start_index < 0:
        raise RuntimeError(f"{path}: start marker not found: {start!r}")
    end_index = text.find(end, start_index)
    if end_index < 0:
        raise RuntimeError(f"{path}: end marker not found: {end!r}")
    path.write_text(text[:start_index] + replacement + text[end_index:])


admin = Path("src/routes/app.admin.bookings.tsx")
replace_once(
    admin,
    'import { formatZAR } from "@/lib/pricing";\n',
    'import { formatZAR } from "@/lib/pricing";\nimport { asQuoteSummaries, pricingDb } from "@/lib/pricing-api";\n',
)
replace_once(
    admin,
    '''type Quote = {
  id: string;
  booking_id: string;
  status: string;
  total: number;
  currency: string;
  notes: string | null;
};''',
    '''type Quote = {
  id: string;
  booking_id: string;
  quote_reference: string;
  status: string;
  revision_number: number;
  final_total: number;
  currency: string;
  valid_until: string | null;
  sent_at: string | null;
  accepted_at: string | null;
  declined_at: string | null;
  expired_at: string | null;
  superseded_at: string | null;
  row_version: number;
};''',
)
replace_once(
    admin,
    '''          supabase
            .from("service_quotes")
            .select("id,booking_id,status,total,currency,notes")
            .in("booking_id", ids),''',
    '''          pricingDb.rpc("admin_quote_summaries", { p_booking_ids: ids }),''',
)
replace_once(
    admin,
    '        setQuotes((qr.data ?? []) as Quote[]);',
    '        setQuotes(asQuoteSummaries(qr.data) as Quote[]);',
)
replace_once(admin, '  const [quoteTotal, setQuoteTotal] = useState<string>("");\n', '')
replace_once(admin, '  const [quoteNotes, setQuoteNotes] = useState<string>("");\n', '')
replace_once(
    admin,
    '''    const q = quotes.find((x) => x.booking_id === booking.id);
    setQuoteTotal(q ? String(q.total) : "");
    setQuoteNotes(q?.notes ?? "");
''',
    '',
)
replace_between(
    admin,
    '  async function saveQuote(sendNow: boolean) {',
    '  async function confirmResources() {',
    '',
)
replace_once(admin, '{formatZAR(Number(q.total))}', '{formatZAR(Number(q.final_total))}')
replace_once(
    admin,
    '''        {booking.service_type === "extended_journey" ? (
          <ExtendedJourneyAdminPanel
            booking={booking as unknown as EJBooking}
            drivers={drivers}
            primaryDriverId={driverId || null}
            onChanged={onChanged}
            actorId={actorId}
          />
        ) : (
          <section className="grid gap-2 rounded-lg border p-3">
            <h4 className="text-sm font-semibold flex items-center gap-1">
              <ClipboardList className="h-3.5 w-3.5" /> Quote
            </h4>
            <div className="grid gap-2 sm:grid-cols-2">
              <div>
                <Label htmlFor="qt-total">Total (ZAR)</Label>
                <Input
                  id="qt-total"
                  type="number"
                  min="0"
                  step="0.01"
                  value={quoteTotal}
                  onChange={(e) => setQuoteTotal(e.target.value)}
                />
              </div>
              <div>
                <Label htmlFor="qt-notes">Notes</Label>
                <Input
                  id="qt-notes"
                  value={quoteNotes}
                  onChange={(e) => setQuoteNotes(e.target.value)}
                />
              </div>
            </div>
            <div className="flex justify-end gap-2">
              <Button size="sm" variant="outline" disabled={busy} onClick={() => saveQuote(false)}>
                Save draft
              </Button>
              <Button size="sm" disabled={busy} onClick={() => saveQuote(true)}>
                Send to customer
              </Button>
            </div>
            {q ? (
              <p className="text-xs text-muted-foreground">
                Current: {q.status} · {formatZAR(Number(q.final_total))}
              </p>
            ) : null}
          </section>
        )}''',
    '''        {booking.service_type === "extended_journey" ? (
          <ExtendedJourneyAdminPanel
            booking={booking as unknown as EJBooking}
            drivers={drivers}
            primaryDriverId={driverId || null}
            onChanged={onChanged}
            actorId={actorId}
          />
        ) : (
          <section className="grid gap-2 rounded-lg border border-primary/25 bg-primary/5 p-3">
            <h4 className="flex items-center gap-1 text-sm font-semibold">
              <ClipboardList className="h-3.5 w-3.5" /> Calculated quote
            </h4>
            <p className="text-xs text-muted-foreground">
              Generate quote revisions from the effective published pricing version. Manual totals are disabled.
            </p>
            {q ? (
              <p className="text-xs">
                Latest: {q.status} · revision {q.revision_number} · {formatZAR(Number(q.final_total))}
              </p>
            ) : null}
            <Button asChild size="sm" className="w-fit">
              <Link to="/app/admin/bookings/$bookingId/quote" params={{ bookingId: booking.id }}>
                Open quote workspace
              </Link>
            </Button>
          </section>
        )}''',
)

passenger = Path("src/routes/app.passenger.bookings.tsx")
replace_once(
    passenger,
    'import { formatZAR } from "@/lib/pricing";\n',
    'import { formatZAR } from "@/lib/pricing";\nimport { asQuoteSummaries, pricingDb } from "@/lib/pricing-api";\n',
)
replace_once(passenger, 'import { toast } from "sonner";\n', '')
replace_once(
    passenger,
    '''type Quote = {
  id: string;
  booking_id: string;
  status: string;
  total: number;
  currency: string;
  valid_until: string | null;
  notes: string | null;
};''',
    '''type Quote = {
  id: string;
  booking_id: string;
  quote_reference: string;
  status: string;
  revision_number: number;
  final_total: number;
  currency: string;
  valid_until: string | null;
  sent_at: string | null;
  accepted_at: string | null;
  declined_at: string | null;
  expired_at: string | null;
  superseded_at: string | null;
  row_version: number;
};''',
)
replace_between(passenger, 'type QuoteItem = {', 'type Itinerary = {', '')
replace_once(passenger, '  const [quoteItems, setQuoteItems] = useState<QuoteItem[]>([]);\n', '')
replace_once(
    passenger,
    '''          supabase
            .from("service_quotes")
            .select("id,booking_id,status,total,currency,valid_until,notes")
            .in("booking_id", ids),''',
    '''          pricingDb.rpc("passenger_quote_summaries", {}),''',
)
replace_once(
    passenger,
    '''        const qs = (qr.data ?? []) as Quote[];
        setQuotes(qs);''',
    '''        const qs = asQuoteSummaries(qr.data) as Quote[];
        setQuotes(qs);''',
)
replace_between(
    passenger,
    '        if (qs.length) {',
    '        const vIds = Array.from(',
    '',
)
passenger_text = passenger.read_text().replace('Number(q.total)', 'Number(q.final_total)')
passenger.write_text(passenger_text)
replace_between(
    passenger,
    '                {b.service_type === "extended_journey" && q ? (',
    '\n                {b.service_type === "extended_journey" &&',
    '''                {q ? (
                  <div className="mt-2 flex justify-end">
                    <Button asChild size="sm" variant="outline">
                      <Link to="/app/passenger/bookings/$bookingId/quote" params={{ bookingId: b.id }}>
                        Review quote revision {q.revision_number}
                      </Link>
                    </Button>
                  </div>
                ) : null}
''',
)
replace_between(
    passenger,
    '                {b.status === "quoted" && q ? (',
    '              </article>',
    '''                {b.status === "quoted" && q ? (
                  <div className="mt-2 flex flex-wrap gap-2">
                    <Button asChild size="sm">
                      <Link to="/app/passenger/bookings/$bookingId/quote" params={{ bookingId: b.id }}>
                        Review and respond
                      </Link>
                    </Button>
                  </div>
                ) : null}
''',
)

for path in (admin, passenger):
    text = path.read_text()
    if '.from("service_quotes")' in text or '.from("service_quote_items")' in text:
        raise RuntimeError(f"{path}: direct quote table access remains")

print("Phase 4 quote list integration applied")
