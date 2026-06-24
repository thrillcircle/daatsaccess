import { useEffect, useMemo, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { toast } from "sonner";
import { Plus, Trash2, Receipt, Wallet, UserPlus } from "lucide-react";
import { formatZAR } from "@/lib/pricing";
import {
  QUOTE_LINE_LABEL,
  type QuoteLineCategory,
  type ExtendedJourneyMetadata,
} from "@/lib/booking-types";

type DepositStatus = "none" | "pending" | "paid" | "refunded" | "waived";

export type EJBooking = {
  id: string;
  booked_by_user_id: string;
  booking_reference: string;
  start_at: string | null;
  end_at: string | null;
  status: string;
  quoted_total: number | null;
  deposit_amount: number | null;
  deposit_status: DepositStatus;
  metadata: unknown;
};

type QuoteItem = {
  id: string;
  quote_id: string;
  label: string;
  description: string | null;
  quantity: number;
  unit_price: number;
  line_total: number;
  sort_order: number;
};

type Quote = {
  id: string;
  booking_id: string;
  status: string;
  total: number;
  subtotal: number;
  tax_amount: number;
  currency: string;
  notes: string | null;
  valid_until: string | null;
};

type DriverProfile = { user_id: string; full_name: string | null };

type DraftLine = {
  id?: string;
  category: QuoteLineCategory;
  label: string;
  description: string;
  quantity: number;
  unit_price: number;
};

const CATEGORIES: QuoteLineCategory[] = [
  "base_transport", "distance", "driver_time", "companion_hours",
  "waiting_time", "additional_legs", "parking", "tolls",
  "overnight", "accommodation", "other",
];

function isMetadata(x: unknown): x is Partial<ExtendedJourneyMetadata> {
  return !!x && typeof x === "object";
}

export function ExtendedJourneyAdminPanel({
  booking,
  drivers,
  primaryDriverId,
  onChanged,
  actorId,
}: {
  booking: EJBooking;
  drivers: DriverProfile[];
  primaryDriverId: string | null;
  onChanged: () => void;
  actorId: string;
}) {
  const [quote, setQuote] = useState<Quote | null>(null);
  const [items, setItems] = useState<DraftLine[]>([]);
  const [notes, setNotes] = useState("");
  const [validUntil, setValidUntil] = useState<string>("");
  const [depositAmount, setDepositAmount] = useState<string>(
    booking.deposit_amount != null ? String(booking.deposit_amount) : "",
  );
  const [depositStatus, setDepositStatus] = useState<DepositStatus>(booking.deposit_status);
  const [reliefId, setReliefId] = useState<string>("");
  const [reliefExisting, setReliefExisting] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const meta = isMetadata(booking.metadata) ? booking.metadata : {};

  useEffect(() => {
    (async () => {
      const { data: q } = await supabase
        .from("service_quotes")
        .select("id,booking_id,status,total,subtotal,tax_amount,currency,notes,valid_until")
        .eq("booking_id", booking.id)
        .maybeSingle();
      if (q) {
        setQuote(q as Quote);
        setNotes(q.notes ?? "");
        setValidUntil(q.valid_until ? q.valid_until.slice(0, 10) : "");
        const { data: lines } = await supabase
          .from("service_quote_items")
          .select("*")
          .eq("quote_id", q.id)
          .order("sort_order");
        const ls: DraftLine[] = ((lines ?? []) as QuoteItem[]).map((l) => ({
          id: l.id,
          category: (l.description?.startsWith("category:") ? (l.description.replace("category:", "").split("|")[0] as QuoteLineCategory) : "other"),
          label: l.label,
          description: l.description?.includes("|") ? l.description.split("|").slice(1).join("|") : (l.description ?? ""),
          quantity: Number(l.quantity),
          unit_price: Number(l.unit_price),
        }));
        setItems(ls);
      }
      const { data: rd } = await supabase
        .from("booking_driver_assignments")
        .select("driver_user_id, assignment_role")
        .eq("booking_id", booking.id)
        .eq("assignment_role", "relief")
        .maybeSingle();
      if (rd) {
        setReliefExisting(rd.driver_user_id);
        setReliefId(rd.driver_user_id);
      }
    })();
  }, [booking.id]);

  const subtotal = useMemo(
    () => items.reduce((s, it) => s + it.quantity * it.unit_price, 0),
    [items],
  );

  function addLine(cat: QuoteLineCategory = "other") {
    setItems((prev) => [...prev, { category: cat, label: QUOTE_LINE_LABEL[cat], description: "", quantity: 1, unit_price: 0 }]);
  }
  function updateLine(i: number, patch: Partial<DraftLine>) {
    setItems((prev) => prev.map((it, idx) => (idx === i ? { ...it, ...patch } : it)));
  }
  function removeLine(i: number) { setItems((prev) => prev.filter((_, idx) => idx !== i)); }

  async function logEvent(eventType: string, payload: Record<string, unknown>) {
    await supabase.from("service_booking_events").insert({
      booking_id: booking.id, actor_user_id: actorId, event_type: eventType, payload: payload as never,
    });
  }

  async function saveQuote(sendNow: boolean) {
    if (items.length === 0) { toast.error("Add at least one line item"); return; }
    setBusy(true);
    try {
      let qid = quote?.id ?? null;
      const total = subtotal;
      const payload = {
        booking_id: booking.id,
        subtotal: total,
        total,
        notes: notes.trim() || null,
        valid_until: validUntil ? new Date(validUntil + "T23:59:59").toISOString() : null,
        status: sendNow ? "sent" : "draft",
      };
      if (qid) {
        const { error } = await supabase.from("service_quotes").update(payload).eq("id", qid);
        if (error) throw error;
      } else {
        const { data, error } = await supabase.from("service_quotes").insert({ ...payload, created_by_user_id: actorId }).select().single();
        if (error) throw error;
        qid = data.id;
      }
      // Replace line items
      await supabase.from("service_quote_items").delete().eq("quote_id", qid!);
      const inserts = items.map((it, i) => ({
        quote_id: qid!,
        label: it.label || QUOTE_LINE_LABEL[it.category],
        description: `category:${it.category}|${it.description}`,
        quantity: it.quantity,
        unit_price: it.unit_price,
        line_total: it.quantity * it.unit_price,
        sort_order: i,
      }));
      if (inserts.length) {
        const { error: iErr } = await supabase.from("service_quote_items").insert(inserts);
        if (iErr) throw iErr;
      }
      if (sendNow) {
        const depNum = Number(depositAmount) || 0;
        await supabase.from("service_bookings").update({
          status: "quoted",
          quoted_total: total,
          deposit_amount: depNum > 0 ? depNum : null,
          deposit_status: depNum > 0 ? (depositStatus === "none" ? "pending" : depositStatus) : depositStatus,
        }).eq("id", booking.id);
        await logEvent("quote_sent", { total, valid_until: payload.valid_until, deposit_amount: depNum });
        // Notify booker
        await supabase.from("notifications").insert({
          user_id: booking.booked_by_user_id,
          type: "extended_journey_quote_ready",
          title: "Your Extended Journey quote is ready",
          body: `Quote total ${formatZAR(total)} · Booking ${booking.booking_reference}`,
        });
      } else {
        await logEvent("quote_saved", { total });
      }
      toast.success(sendNow ? "Quote sent" : "Draft saved");
      onChanged();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed");
    } finally { setBusy(false); }
  }

  async function reviseQuote() {
    if (!quote) return;
    setBusy(true);
    try {
      await supabase.from("service_quotes").update({ status: "draft" }).eq("id", quote.id);
      await supabase.from("service_bookings").update({ status: "awaiting_quote" }).eq("id", booking.id);
      await logEvent("quote_revised", { quote_id: quote.id });
      toast.success("Quote reverted to draft for revision");
      onChanged();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed");
    } finally { setBusy(false); }
  }

  async function saveDeposit() {
    setBusy(true);
    try {
      const amt = Number(depositAmount);
      await supabase.from("service_bookings").update({
        deposit_amount: Number.isFinite(amt) && amt > 0 ? amt : null,
        deposit_status: depositStatus,
      }).eq("id", booking.id);
      await logEvent("deposit_updated", { deposit_amount: amt, deposit_status: depositStatus });
      toast.success("Deposit updated");
      onChanged();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed");
    } finally { setBusy(false); }
  }

  async function saveRelief() {
    if (!reliefId) { toast.error("Pick a relief driver"); return; }
    if (reliefId === primaryDriverId) { toast.error("Relief must differ from primary driver"); return; }
    setBusy(true);
    try {
      await supabase.from("booking_driver_assignments")
        .delete().eq("booking_id", booking.id).eq("assignment_role", "relief");
      const { error } = await supabase.from("booking_driver_assignments").insert({
        booking_id: booking.id, driver_user_id: reliefId, status: "confirmed", assignment_role: "relief",
      });
      if (error) throw error;
      setReliefExisting(reliefId);
      await logEvent("relief_driver_assigned", { driver_user_id: reliefId });
      toast.success("Relief driver assigned");
      onChanged();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed");
    } finally { setBusy(false); }
  }
  async function clearRelief() {
    setBusy(true);
    try {
      await supabase.from("booking_driver_assignments")
        .delete().eq("booking_id", booking.id).eq("assignment_role", "relief");
      setReliefExisting(null);
      setReliefId("");
      await logEvent("relief_driver_cleared", {});
      onChanged();
    } finally { setBusy(false); }
  }

  return (
    <>
      {/* Metadata view */}
      <section className="rounded-lg border p-3 text-sm">
        <h4 className="font-semibold">Extended Journey details</h4>
        <dl className="mt-2 grid grid-cols-2 gap-x-3 gap-y-1 text-xs">
          <div className="col-span-2">
            <dt className="text-muted-foreground">Dates</dt>
            <dd>
              {booking.start_at ? new Date(booking.start_at).toLocaleDateString("en-ZA", { dateStyle: "medium" }) : "—"}
              {" → "}
              {booking.end_at ? new Date(booking.end_at).toLocaleDateString("en-ZA", { dateStyle: "medium" }) : "—"}
            </dd>
          </div>
          <div><dt className="text-muted-foreground">Group size</dt><dd>{meta.group_size ?? "—"}</dd></div>
          <div><dt className="text-muted-foreground">Wheelchairs</dt><dd>{meta.wheelchair_count ?? 0}</dd></div>
          <div><dt className="text-muted-foreground">Other equipment</dt><dd>{meta.mobility_equipment_count ?? 0}</dd></div>
          <div className="col-span-2"><dt className="text-muted-foreground">Starting location</dt><dd>{meta.starting_location || "—"}</dd></div>
          <div className="col-span-2"><dt className="text-muted-foreground">Main destination</dt><dd>{meta.main_destination || "—"}</dd></div>
          {meta.planned_destinations?.length ? (
            <div className="col-span-2"><dt className="text-muted-foreground">Planned stops</dt><dd>{meta.planned_destinations.join(", ")}</dd></div>
          ) : null}
          {meta.luggage_requirements ? <div className="col-span-2"><dt className="text-muted-foreground">Luggage</dt><dd>{meta.luggage_requirements}</dd></div> : null}
          {meta.accommodation_requirements ? <div className="col-span-2"><dt className="text-muted-foreground">Accommodation</dt><dd>{meta.accommodation_requirements}</dd></div> : null}
          {meta.overnight_support_requirements ? <div className="col-span-2"><dt className="text-muted-foreground">Overnight support</dt><dd>{meta.overnight_support_requirements}</dd></div> : null}
          {meta.general_support_instructions ? <div className="col-span-2"><dt className="text-muted-foreground">General support</dt><dd>{meta.general_support_instructions}</dd></div> : null}
          {meta.emergency_contact?.name ? (
            <div className="col-span-2">
              <dt className="text-muted-foreground">Emergency contact</dt>
              <dd>
                {meta.emergency_contact.name}
                {meta.emergency_contact.relationship ? ` (${meta.emergency_contact.relationship})` : ""}
                {" · "}{meta.emergency_contact.phone}
              </dd>
            </div>
          ) : null}
          {meta.additional_travellers?.length ? (
            <div className="col-span-2">
              <dt className="text-muted-foreground">Additional travellers</dt>
              <dd>{meta.additional_travellers.map((t) => t.full_name).join(", ")}</dd>
            </div>
          ) : null}
        </dl>
      </section>

      {/* Multi-line quote builder */}
      <section className="rounded-lg border p-3">
        <h4 className="text-sm font-semibold flex items-center gap-1"><Receipt className="h-3.5 w-3.5" /> Quote builder</h4>
        <div className="mt-2 space-y-2">
          {items.length === 0 ? (
            <p className="text-xs text-muted-foreground">No line items yet — admin sets all rates per booking.</p>
          ) : (
            items.map((it, i) => (
              <div key={i} className="grid gap-2 rounded border bg-background/40 p-2 sm:grid-cols-[150px_1fr_70px_110px_110px_auto]">
                <Select value={it.category} onValueChange={(v) => updateLine(i, { category: v as QuoteLineCategory, label: it.label || QUOTE_LINE_LABEL[v as QuoteLineCategory] })}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {CATEGORIES.map((c) => <SelectItem key={c} value={c}>{QUOTE_LINE_LABEL[c]}</SelectItem>)}
                  </SelectContent>
                </Select>
                <Input placeholder="Label" value={it.label} onChange={(e) => updateLine(i, { label: e.target.value })} />
                <Input type="number" min={0} step="0.01" value={it.quantity} onChange={(e) => updateLine(i, { quantity: Number(e.target.value) || 0 })} />
                <Input type="number" min={0} step="0.01" value={it.unit_price} onChange={(e) => updateLine(i, { unit_price: Number(e.target.value) || 0 })} />
                <div className="grid place-items-center text-sm">{formatZAR(it.quantity * it.unit_price)}</div>
                <Button type="button" size="sm" variant="ghost" onClick={() => removeLine(i)}><Trash2 className="h-3.5 w-3.5" /></Button>
              </div>
            ))
          )}
        </div>
        <div className="mt-2 flex flex-wrap gap-2">
          {CATEGORIES.map((c) => (
            <Button key={c} type="button" size="sm" variant="outline" onClick={() => addLine(c)}>
              <Plus className="h-3.5 w-3.5" /> {QUOTE_LINE_LABEL[c]}
            </Button>
          ))}
        </div>
        <div className="mt-3 grid gap-2 sm:grid-cols-2">
          <div>
            <Label>Valid until</Label>
            <Input type="date" value={validUntil} onChange={(e) => setValidUntil(e.target.value)} />
          </div>
          <div>
            <Label>Notes</Label>
            <Textarea rows={2} value={notes} onChange={(e) => setNotes(e.target.value)} />
          </div>
        </div>
        <div className="mt-2 flex items-center justify-between">
          <p className="text-sm font-medium">Subtotal / total: {formatZAR(subtotal)}</p>
          <div className="flex gap-2">
            {quote && quote.status !== "draft" ? (
              <Button size="sm" variant="outline" disabled={busy} onClick={reviseQuote}>Revise</Button>
            ) : null}
            <Button size="sm" variant="outline" disabled={busy} onClick={() => saveQuote(false)}>Save draft</Button>
            <Button size="sm" disabled={busy} onClick={() => saveQuote(true)}>Send quote</Button>
          </div>
        </div>
        {quote ? <p className="mt-1 text-xs text-muted-foreground">Current: {quote.status} · {formatZAR(Number(quote.total))}{quote.valid_until ? ` · valid until ${new Date(quote.valid_until).toLocaleDateString("en-ZA")}` : ""}</p> : null}
      </section>

      {/* Deposit */}
      <section className="rounded-lg border p-3">
        <h4 className="text-sm font-semibold flex items-center gap-1"><Wallet className="h-3.5 w-3.5" /> Deposit</h4>
        <div className="mt-2 grid gap-2 sm:grid-cols-[1fr_1fr_auto]">
          <div>
            <Label>Amount (ZAR)</Label>
            <Input type="number" min={0} step="0.01" value={depositAmount} onChange={(e) => setDepositAmount(e.target.value)} />
          </div>
          <div>
            <Label>Status</Label>
            <Select value={depositStatus} onValueChange={(v) => setDepositStatus(v as DepositStatus)}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                {(["none", "pending", "paid", "waived", "refunded"] as DepositStatus[]).map((s) => (
                  <SelectItem key={s} value={s}>{s}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="grid items-end">
            <Button size="sm" disabled={busy} onClick={saveDeposit}>Save deposit</Button>
          </div>
        </div>
        <p className="mt-1 text-[11px] text-muted-foreground">Payment gateway not integrated yet — mark manually.</p>
      </section>

      {/* Relief driver */}
      <section className="rounded-lg border p-3">
        <h4 className="text-sm font-semibold flex items-center gap-1"><UserPlus className="h-3.5 w-3.5" /> Relief driver (optional)</h4>
        <div className="mt-2 grid gap-2 sm:grid-cols-[1fr_auto_auto]">
          <Select value={reliefId} onValueChange={setReliefId}>
            <SelectTrigger><SelectValue placeholder="Assign relief driver" /></SelectTrigger>
            <SelectContent>
              {drivers.filter((d) => d.user_id !== primaryDriverId).map((d) => (
                <SelectItem key={d.user_id} value={d.user_id}>{d.full_name ?? d.user_id.slice(0, 8)}</SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Button size="sm" disabled={busy || !reliefId} onClick={saveRelief}>Save relief</Button>
          {reliefExisting ? <Button size="sm" variant="ghost" disabled={busy} onClick={clearRelief}>Clear</Button> : null}
        </div>
        {reliefExisting ? <Badge variant="secondary" className="mt-1 text-[10px]">Relief assigned</Badge> : null}
      </section>
    </>
  );
}
