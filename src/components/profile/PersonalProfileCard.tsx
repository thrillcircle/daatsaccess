import { useEffect, useRef, useState } from "react";
import type { User } from "@supabase/supabase-js";
import { Camera, CheckCircle2, Loader2, LockKeyhole } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { toast } from "sonner";
import type { Database } from "@/integrations/supabase/types";

type Profile = Database["public"]["Tables"]["profiles"]["Row"];
const PHONE_RE = /^\+?[0-9 ()-]{7,20}$/;

export function PersonalProfileCard({
  user,
  readOnly,
  roleLabel,
}: {
  user: User;
  readOnly: boolean;
  roleLabel: string;
}) {
  const [profile, setProfile] = useState<Profile | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [fullName, setFullName] = useState("");
  const [phone, setPhone] = useState("");
  const [avatarUrl, setAvatarUrl] = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    let cancelled = false;
    const load = async () => {
      setLoading(true);
      setError(null);
      const { data, error: loadError } = await supabase
        .from("profiles")
        .select("*")
        .eq("user_id", user.id)
        .maybeSingle();
      if (cancelled) return;
      if (loadError) {
        setError(loadError.message);
        setLoading(false);
        return;
      }
      let row = data;
      if (!row) {
        const { data: created, error: createError } = await supabase
          .from("profiles")
          .insert({ user_id: user.id })
          .select()
          .single();
        if (cancelled) return;
        if (createError) {
          setError(createError.message);
          setLoading(false);
          return;
        }
        row = created;
      }
      setProfile(row);
      setFullName(row?.full_name ?? "");
      setPhone(row?.phone ?? "");
      if (row?.avatar_url) {
        const { data: signed } = await supabase.storage
          .from("avatars")
          .createSignedUrl(row.avatar_url, 60 * 60);
        if (!cancelled) setAvatarUrl(signed?.signedUrl ?? null);
      }
      setLoading(false);
    };
    void load();
    return () => {
      cancelled = true;
    };
  }, [user.id]);

  async function save() {
    const nextName = fullName.trim();
    const nextPhone = phone.trim().replace(/\s+/g, " ");
    if (!nextName || nextName.length > 80) {
      toast.error("Enter a valid full name");
      return;
    }
    if (!PHONE_RE.test(nextPhone)) {
      toast.error("Enter a valid phone number");
      return;
    }
    setSaving(true);
    const { data, error: saveError } = await supabase
      .from("profiles")
      .update({ full_name: nextName, phone: nextPhone })
      .eq("user_id", user.id)
      .select()
      .single();
    setSaving(false);
    if (saveError) {
      toast.error(saveError.message);
      return;
    }
    setProfile(data);
    toast.success("Profile saved");
  }

  async function uploadAvatar(file: File) {
    if (readOnly) return;
    if (!file.type.startsWith("image/") || file.size > 5 * 1024 * 1024) {
      toast.error("Choose a JPG, PNG, WebP or GIF under 5 MB");
      return;
    }
    const allowed = ["image/jpeg", "image/png", "image/webp", "image/gif"];
    if (!allowed.includes(file.type)) {
      toast.error("Unsupported image format");
      return;
    }
    setUploading(true);
    const previous = profile?.avatar_url ?? null;
    try {
      const extension = (file.name.split(".").pop() ?? "jpg").replace(/[^a-z0-9]/gi, "");
      const path = `${user.id}/avatar-${Date.now()}.${extension || "jpg"}`;
      const { error: uploadError } = await supabase.storage
        .from("avatars")
        .upload(path, file, { contentType: file.type, upsert: false, cacheControl: "3600" });
      if (uploadError) throw uploadError;
      const { data: updated, error: updateError } = await supabase
        .from("profiles")
        .update({ avatar_url: path })
        .eq("user_id", user.id)
        .select()
        .single();
      if (updateError) {
        await supabase.storage.from("avatars").remove([path]);
        throw updateError;
      }
      if (previous && previous !== path) {
        await supabase.storage.from("avatars").remove([previous]);
      }
      const { data: signed } = await supabase.storage.from("avatars").createSignedUrl(path, 60 * 60);
      setProfile(updated);
      setAvatarUrl(signed?.signedUrl ?? null);
      toast.success("Photo updated");
    } catch (uploadError) {
      toast.error(uploadError instanceof Error ? uploadError.message : "Photo upload failed");
    } finally {
      setUploading(false);
    }
  }

  if (loading) {
    return (
      <section className="rounded-2xl border bg-card p-4 shadow-sm">
        <p className="flex items-center gap-2 text-sm text-muted-foreground">
          <Loader2 className="h-4 w-4 animate-spin" /> Loading profile…
        </p>
      </section>
    );
  }

  if (error) {
    return (
      <section className="rounded-2xl border border-destructive/40 bg-destructive/5 p-4 text-sm text-destructive">
        {error}
      </section>
    );
  }

  const complete = !!profile?.full_name && !!profile?.phone;

  return (
    <section className="space-y-4 rounded-2xl border bg-card p-4 shadow-sm">
      <div className="flex items-start justify-between gap-3">
        <div className="flex min-w-0 items-center gap-4">
          <div className="relative shrink-0">
            <div className="grid h-20 w-20 place-items-center overflow-hidden rounded-full bg-secondary text-2xl font-semibold text-muted-foreground">
              {avatarUrl ? (
                <img src={avatarUrl} alt="Profile" className="h-full w-full object-cover" />
              ) : (
                (fullName || "?").slice(0, 1).toUpperCase()
              )}
            </div>
            {!readOnly ? (
              <>
                <button
                  type="button"
                  onClick={() => fileRef.current?.click()}
                  disabled={uploading}
                  className="absolute -bottom-1 -right-1 grid h-8 w-8 place-items-center rounded-full border bg-background shadow disabled:opacity-60"
                  aria-label="Change profile photo"
                >
                  {uploading ? <Loader2 className="h-4 w-4 animate-spin" /> : <Camera className="h-4 w-4" />}
                </button>
                <input
                  ref={fileRef}
                  type="file"
                  className="hidden"
                  accept="image/jpeg,image/png,image/webp,image/gif"
                  onChange={(event) => {
                    const file = event.target.files?.[0];
                    if (file) void uploadAvatar(file);
                    event.target.value = "";
                  }}
                />
              </>
            ) : null}
          </div>
          <div className="min-w-0">
            <p className="truncate font-semibold">{profile?.full_name || "Unnamed"}</p>
            <p className="truncate text-sm text-muted-foreground">{user.email ?? "No email"}</p>
            <div className="mt-2 flex flex-wrap gap-2">
              <Badge variant="outline">{roleLabel}</Badge>
              <Badge variant={complete ? "default" : "secondary"}>
                {complete ? "Profile complete" : "Profile incomplete"}
              </Badge>
            </div>
          </div>
        </div>
        {readOnly ? <LockKeyhole className="h-4 w-4 text-muted-foreground" /> : null}
      </div>

      <div className="space-y-3">
        <div className="space-y-1.5">
          <Label htmlFor={`profile-name-${user.id}`}>Full name</Label>
          <Input
            id={`profile-name-${user.id}`}
            value={fullName}
            onChange={(event) => setFullName(event.target.value)}
            readOnly={readOnly}
            maxLength={80}
            autoComplete="name"
          />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor={`profile-phone-${user.id}`}>Phone number</Label>
          <Input
            id={`profile-phone-${user.id}`}
            value={phone}
            onChange={(event) => setPhone(event.target.value)}
            readOnly={readOnly}
            maxLength={20}
            inputMode="tel"
            autoComplete="tel"
          />
        </div>
        <div className="space-y-1.5">
          <Label>Email</Label>
          <Input value={user.email ?? ""} readOnly />
        </div>
      </div>

      {readOnly ? (
        <p className="flex items-start gap-2 rounded-xl bg-secondary p-3 text-xs text-muted-foreground">
          <LockKeyhole className="mt-0.5 h-3.5 w-3.5 shrink-0" />
          Driver identity and operational records are managed by Access administration.
        </p>
      ) : (
        <Button className="w-full" onClick={save} disabled={saving || uploading}>
          {saving ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <CheckCircle2 className="mr-2 h-4 w-4" />}
          Save personal details
        </Button>
      )}
    </section>
  );
}
