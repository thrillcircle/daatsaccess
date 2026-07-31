import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { toast } from "sonner";

export const Route = createFileRoute("/auth")({
  head: () => ({
    meta: [
      { title: "Sign in — Access" },
      {
        name: "description",
        content:
          "Sign in to Access or create an account to book rides, assisted travel and appointment transport across South Africa.",
      },
      { property: "og:title", content: "Sign in — Access" },
      {
        property: "og:description",
        content:
          "Sign in to Access or create an account to book rides, assisted travel and appointment transport across South Africa.",
      },
      { property: "og:url", content: "https://daats.app/auth" },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
    links: [{ rel: "canonical", href: "https://daats.app/auth" }],
  }),

  component: AuthPage,
});

function AuthPage() {
  const navigate = useNavigate();
  const [mode, setMode] = useState<"signin" | "signup">("signup");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [fullName, setFullName] = useState("");
  const [phone, setPhone] = useState("");
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => {
      if (data.session) navigate({ to: "/app" });
    });
  }, [navigate]);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);
    try {
      if (mode === "signup") {
        const { error } = await supabase.auth.signUp({
          email,
          password,
          options: {
            emailRedirectTo: `${window.location.origin}/app`,
            data: { full_name: fullName, phone },
          },
        });
        if (error) throw error;
        toast.success("Account created");
      } else {
        const { error } = await supabase.auth.signInWithPassword({ email, password });
        if (error) throw error;
      }
      navigate({ to: "/app" });
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Authentication failed";
      toast.error(msg);
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="min-h-screen bg-background">
      <div className="mx-auto flex min-h-screen max-w-md flex-col px-6 py-8">
        <button
          onClick={() => navigate({ to: "/" })}
          className="text-sm text-muted-foreground hover:text-foreground"
        >
          ← Back
        </button>

        <main className="flex-1">
          <div className="mt-8 space-y-1">
            <h1 className="text-3xl font-semibold tracking-tight">
              {mode === "signup" ? "Create your account" : "Welcome back"}
            </h1>
            <p className="text-sm text-muted-foreground">
              {mode === "signup" ? "Sign up to request rides or drive." : "Sign in to continue."}
            </p>
          </div>

          <form onSubmit={onSubmit} className="mt-6 space-y-4">
            {mode === "signup" && (
              <>
                <div className="space-y-1.5">
                  <Label htmlFor="name">Full name</Label>
                  <Input
                    id="name"
                    required
                    value={fullName}
                    onChange={(e) => setFullName(e.target.value)}
                    placeholder="Thandi Dlamini"
                  />
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="phone">Phone</Label>
                  <Input
                    id="phone"
                    required
                    type="tel"
                    value={phone}
                    onChange={(e) => setPhone(e.target.value)}
                    placeholder="+27 71 234 5678"
                  />
                </div>
              </>
            )}
            <div className="space-y-1.5">
              <Label htmlFor="email">Email</Label>
              <Input
                id="email"
                type="email"
                required
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                autoComplete="email"
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="password">Password</Label>
              <Input
                id="password"
                type="password"
                required
                minLength={8}
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                autoComplete={mode === "signup" ? "new-password" : "current-password"}
              />
            </div>

            <Button type="submit" size="lg" className="w-full" disabled={loading}>
              {loading ? "Please wait…" : mode === "signup" ? "Create account" : "Sign in"}
            </Button>
          </form>

          <button
            onClick={() => setMode((m) => (m === "signup" ? "signin" : "signup"))}
            className="mt-6 text-center text-sm text-muted-foreground hover:text-foreground"
          >
            {mode === "signup" ? "Already have an account? Sign in" : "New here? Create an account"}
          </button>
        </main>
      </div>
    </div>
  );
}
