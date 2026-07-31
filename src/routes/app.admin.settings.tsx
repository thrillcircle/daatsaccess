import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { Save } from "lucide-react";
import { toast } from "sonner";
import { AdminShell } from "@/components/AdminShell";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { listSettings, updateSetting, type AppSetting } from "@/lib/architecture-closeout";

export const Route = createFileRoute("/app/admin/settings")({
  head: () => ({ meta: [{ title: "Settings — Access Admin" }] }),
  component: SettingsPage,
});

function SettingsPage() {
  const [settings, setSettings] = useState<AppSetting[]>([]);
  const [drafts, setDrafts] = useState<Record<string, string>>({});
  const [loading, setLoading] = useState(true);
  async function load() {
    setLoading(true);
    try {
      const rows = await listSettings();
      setSettings(rows);
      setDrafts(Object.fromEntries(rows.map((r) => [r.key, JSON.stringify(r.value, null, 2)])));
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Could not load settings");
    } finally {
      setLoading(false);
    }
  }
  useEffect(() => {
    void load();
  }, []);
  async function save(setting: AppSetting) {
    try {
      const value = JSON.parse(drafts[setting.key]);
      await updateSetting(setting.key, value);
      toast.success(`${setting.key} saved`);
      await load();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Use valid JSON before saving");
    }
  }
  return (
    <AdminShell
      title="Settings"
      subtitle="Adjust business, booking, notification, safety and privacy configuration. API keys are never shown here."
    >
      {loading ? (
        <p className="text-sm text-muted-foreground">Loading settings…</p>
      ) : (
        <div className="grid gap-4 lg:grid-cols-2">
          {settings.map((setting) => (
            <section key={setting.key} className="rounded-2xl border bg-card p-4 shadow-sm">
              <p className="text-xs font-semibold uppercase tracking-wide text-primary">
                {setting.category}
              </p>
              <h2 className="mt-1 font-semibold">{setting.key}</h2>
              <p className="mb-3 text-sm text-muted-foreground">{setting.description}</p>
              <Textarea
                aria-label={`Value for ${setting.key}`}
                className="min-h-40 font-mono text-xs"
                value={drafts[setting.key] ?? ""}
                onChange={(e) =>
                  setDrafts((current) => ({ ...current, [setting.key]: e.target.value }))
                }
              />
              <Button className="mt-3" size="sm" onClick={() => void save(setting)}>
                <Save className="mr-2 h-4 w-4" />
                Save setting
              </Button>
            </section>
          ))}
        </div>
      )}
    </AdminShell>
  );
}
