import { useEffect, useState } from "react";
import { BellRing, CheckCircle2, FileLock2, Loader2, ShieldCheck } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import {
  acceptPolicy,
  getComplianceSnapshot,
  getNotificationPreferences,
  submitPrivacyRequest,
  updateNotificationPreferences,
  type ComplianceSnapshot,
  type NotificationPreferences,
} from "@/lib/phase7-commercial";

export function CompliancePrivacyCard() {
  const [snapshot, setSnapshot] = useState<ComplianceSnapshot | null>(null);
  const [preferences, setPreferences] = useState<NotificationPreferences | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState<string | null>(null);

  async function load() {
    setLoading(true);
    try {
      const [compliance, notificationPrefs] = await Promise.all([
        getComplianceSnapshot(),
        getNotificationPreferences(),
      ]);
      setSnapshot(compliance);
      setPreferences(notificationPrefs);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Could not load privacy settings");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void load();
  }, []);

  async function accept(id: string) {
    setBusy(`policy:${id}`);
    try {
      await acceptPolicy(id);
      toast.success("Policy acceptance recorded");
      await load();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Could not record acceptance");
    } finally {
      setBusy(null);
    }
  }

  async function request(type: "data_export" | "account_deletion") {
    if (
      type === "account_deletion" &&
      !window.confirm("Send an account deletion request to Access administration?")
    ) {
      return;
    }
    setBusy(type);
    try {
      await submitPrivacyRequest(type);
      toast.success(
        type === "data_export" ? "Data export requested" : "Account deletion requested",
      );
      await load();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Could not submit privacy request");
    } finally {
      setBusy(null);
    }
  }

  async function savePreferences() {
    if (!preferences) return;
    setBusy("notifications");
    try {
      const next = await updateNotificationPreferences(preferences);
      setPreferences(next);
      toast.success("Notification preferences saved");
    } catch (error) {
      toast.error(
        error instanceof Error ? error.message : "Could not save notification preferences",
      );
    } finally {
      setBusy(null);
    }
  }

  if (loading) {
    return (
      <section className="mt-4 rounded-2xl border bg-card p-4 shadow-sm">
        <p className="flex items-center gap-2 text-sm text-muted-foreground">
          <Loader2 className="h-4 w-4 animate-spin" /> Loading privacy and notifications…
        </p>
      </section>
    );
  }

  return (
    <section className="mt-4 space-y-5 rounded-2xl border bg-card p-4 shadow-sm">
      <div>
        <div className="flex items-center gap-2">
          <ShieldCheck className="h-4 w-4 text-primary" />
          <h2 className="font-semibold">Privacy, policies & consent</h2>
        </div>
        <p className="mt-1 text-sm text-muted-foreground">
          Review published Access policies and manage your POPIA-related requests.
        </p>
      </div>

      <div className="space-y-2">
        <h3 className="flex items-center gap-2 text-sm font-medium">
          <FileLock2 className="h-4 w-4" /> Published policies
        </h3>
        {!snapshot?.policies.length ? (
          <p className="rounded-xl border border-dashed p-3 text-xs text-muted-foreground">
            Approved policy versions will appear here when they are published by Access.
          </p>
        ) : (
          snapshot.policies.map((policy) => (
            <div key={policy.id} className="rounded-xl border p-3 text-sm">
              <div className="flex items-start justify-between gap-3">
                <div>
                  <p className="font-medium">{policy.title}</p>
                  <p className="text-xs text-muted-foreground">Version {policy.version}</p>
                </div>
                {policy.accepted_at ? (
                  <span className="flex items-center gap-1 text-xs text-emerald-700">
                    <CheckCircle2 className="h-3.5 w-3.5" /> Accepted
                  </span>
                ) : (
                  <Button
                    size="sm"
                    variant="outline"
                    disabled={busy === `policy:${policy.id}`}
                    onClick={() => void accept(policy.id)}
                  >
                    Accept
                  </Button>
                )}
              </div>
              {policy.content ? (
                <p className="mt-2 whitespace-pre-wrap text-xs">{policy.content}</p>
              ) : null}
              {policy.document_url ? (
                <a
                  href={policy.document_url}
                  target="_blank"
                  rel="noreferrer"
                  className="mt-2 inline-block text-xs text-primary underline"
                >
                  Open policy document
                </a>
              ) : null}
            </div>
          ))
        )}
      </div>

      <div className="space-y-2 border-t pt-4">
        <h3 className="text-sm font-medium">Your data</h3>
        <div className="flex flex-wrap gap-2">
          <Button
            size="sm"
            variant="outline"
            disabled={busy === "data_export"}
            onClick={() => void request("data_export")}
          >
            Request data export
          </Button>
          <Button
            size="sm"
            variant="outline"
            disabled={busy === "account_deletion"}
            onClick={() => void request("account_deletion")}
          >
            Request account deletion
          </Button>
        </div>
        {snapshot?.privacy_requests.length ? (
          <div className="space-y-1">
            {snapshot.privacy_requests.slice(0, 4).map((item) => (
              <p key={item.id} className="text-xs text-muted-foreground">
                {item.request_type === "data_export" ? "Data export" : "Account deletion"} ·{" "}
                <span className="font-medium text-foreground">
                  {item.status.replaceAll("_", " ")}
                </span>{" "}
                · {new Date(item.created_at).toLocaleDateString("en-ZA")}
              </p>
            ))}
          </div>
        ) : null}
      </div>

      {preferences ? (
        <div className="space-y-3 border-t pt-4">
          <div className="flex items-center gap-2">
            <BellRing className="h-4 w-4 text-primary" />
            <h3 className="text-sm font-medium">Notification preferences</h3>
          </div>
          <p className="text-xs text-muted-foreground">
            In-app safety and operational messages always remain available. External channels are
            used only after Access configures the relevant provider.
          </p>
          <div className="grid grid-cols-2 gap-2 text-sm sm:grid-cols-4">
            {(["push", "sms", "whatsapp", "email"] as const).map((channel) => (
              <label
                key={channel}
                className="flex items-center gap-2 rounded-lg border p-2 capitalize"
              >
                <input
                  type="checkbox"
                  checked={preferences[channel]}
                  onChange={(event) =>
                    setPreferences((current) =>
                      current ? { ...current, [channel]: event.target.checked } : current,
                    )
                  }
                />
                {channel === "whatsapp" ? "WhatsApp" : channel.toUpperCase()}
              </label>
            ))}
          </div>
          <Button
            size="sm"
            onClick={() => void savePreferences()}
            disabled={busy === "notifications"}
          >
            {busy === "notifications" ? "Saving…" : "Save notification preferences"}
          </Button>
        </div>
      ) : null}
    </section>
  );
}
