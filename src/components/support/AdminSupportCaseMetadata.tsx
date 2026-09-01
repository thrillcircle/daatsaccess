import { useMemo, useState } from "react";
import { Scale } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { formatZAR } from "@/lib/pricing";
import { updateSupportCaseMetadata } from "@/lib/phase7-commercial";
import {
  SUPPORT_CASE_SEVERITIES,
  SUPPORT_DECISIONS,
  supportCaseSeverityLabel,
  supportDecisionLabel,
  type SupportCaseSeverity,
  type SupportDecisionType,
  type SupportTicket,
} from "@/lib/support";

function evidenceLines(value: unknown[] | undefined): string {
  return (value ?? [])
    .map((item) => (typeof item === "string" ? item : JSON.stringify(item)))
    .filter(Boolean)
    .join("\n");
}

export function AdminSupportCaseMetadata({ ticket }: { ticket: SupportTicket }) {
  const [severity, setSeverity] = useState<SupportCaseSeverity>(ticket.case_severity ?? "normal");
  const [decision, setDecision] = useState<SupportDecisionType | "">(ticket.decision_type ?? "");
  const [amount, setAmount] = useState(
    ticket.decision_amount == null ? "" : String(ticket.decision_amount),
  );
  const [evidence, setEvidence] = useState(evidenceLines(ticket.evidence));
  const [saving, setSaving] = useState(false);

  const amountValue = useMemo(() => {
    if (!amount.trim()) return null;
    const parsed = Number(amount);
    return Number.isFinite(parsed) && parsed >= 0 ? parsed : Number.NaN;
  }, [amount]);

  const save = async () => {
    if (Number.isNaN(amountValue)) {
      toast.error("Decision amount must be zero or more");
      return;
    }
    setSaving(true);
    try {
      await updateSupportCaseMetadata({
        ticketId: ticket.id,
        caseSeverity: severity,
        decisionType: decision || null,
        decisionAmount: amountValue,
        evidence: evidence
          .split("\n")
          .map((line) => line.trim())
          .filter(Boolean),
      });
      toast.success("Case assessment saved");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Could not save case assessment");
    } finally {
      setSaving(false);
    }
  };

  return (
    <section className="rounded-2xl border bg-card p-4 shadow-sm">
      <div className="flex items-center gap-2">
        <Scale className="h-4 w-4 text-primary" />
        <h2 className="font-semibold">Case assessment</h2>
      </div>
      <p className="mt-1 text-xs text-muted-foreground">
        Record escalation severity, evidence and the approved financial or operational decision.
      </p>

      <div className="mt-4 space-y-3">
        <div className="space-y-1.5">
          <Label htmlFor="case-severity">Case severity</Label>
          <select
            id="case-severity"
            value={severity}
            onChange={(event) => setSeverity(event.target.value as SupportCaseSeverity)}
            className="h-10 w-full rounded-md border bg-background px-3 text-sm"
          >
            {SUPPORT_CASE_SEVERITIES.map((item) => (
              <option key={item.value} value={item.value}>
                {item.label}
              </option>
            ))}
          </select>
        </div>

        <div className="space-y-1.5">
          <Label htmlFor="case-decision">Decision</Label>
          <select
            id="case-decision"
            value={decision}
            onChange={(event) => setDecision(event.target.value as SupportDecisionType | "")}
            className="h-10 w-full rounded-md border bg-background px-3 text-sm"
          >
            <option value="">No decision yet</option>
            {SUPPORT_DECISIONS.map((item) => (
              <option key={item.value} value={item.value}>
                {item.label}
              </option>
            ))}
          </select>
        </div>

        <div className="space-y-1.5">
          <Label htmlFor="case-decision-amount">Decision amount (R)</Label>
          <Input
            id="case-decision-amount"
            inputMode="decimal"
            value={amount}
            onChange={(event) => setAmount(event.target.value)}
            placeholder="0.00"
          />
        </div>

        <div className="space-y-1.5">
          <Label htmlFor="case-evidence">Evidence / attachment references</Label>
          <Textarea
            id="case-evidence"
            rows={4}
            value={evidence}
            onChange={(event) => setEvidence(event.target.value)}
            placeholder="One secure file reference, URL or evidence note per line"
          />
        </div>

        {ticket.safety_incident_id ? (
          <div className="rounded-xl border bg-secondary/40 p-3 text-xs">
            Linked safety incident: <span className="font-mono">{ticket.safety_incident_id}</span>
          </div>
        ) : null}

        <div className="rounded-xl bg-secondary/40 p-3 text-xs text-muted-foreground">
          Current: {supportCaseSeverityLabel(ticket.case_severity ?? "normal")} ·{" "}
          {supportDecisionLabel(ticket.decision_type)}
          {ticket.decision_amount != null ? ` · ${formatZAR(Number(ticket.decision_amount))}` : ""}
        </div>

        <Button className="w-full" onClick={() => void save()} disabled={saving}>
          {saving ? "Saving…" : "Save case assessment"}
        </Button>
      </div>
    </section>
  );
}
