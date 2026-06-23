import { createFileRoute, redirect } from "@tanstack/react-router";
import { useEffect } from "react";
import { useNavigate } from "@tanstack/react-router";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Car } from "lucide-react";

export const Route = createFileRoute("/")({
  head: () => ({
    meta: [
      { title: "Access — Rides for South Africa" },
      {
        name: "description",
        content: "Request rides and drive with Access. A simple, mobile-first ride-hailing app for South Africa.",
      },
      { property: "og:title", content: "Access — Rides for South Africa" },
      {
        property: "og:description",
        content: "Request rides and drive with Access. Built for South Africa.",
      },
    ],
  }),
  component: Landing,
});

function Landing() {
  const navigate = useNavigate();

  useEffect(() => {
    let mounted = true;
    supabase.auth.getSession().then(({ data }) => {
      if (mounted && data.session) navigate({ to: "/app" });
    });
    return () => {
      mounted = false;
    };
  }, [navigate]);

  return (
    <div className="min-h-screen bg-background">
      <div className="mx-auto flex min-h-screen max-w-md flex-col px-6 py-10">
        <header className="flex items-center gap-2">
          <span className="grid h-8 w-8 place-items-center rounded-md bg-primary text-primary-foreground font-bold">
            A
          </span>
          <span className="text-lg font-semibold tracking-tight">Access</span>
        </header>

        <div className="my-auto space-y-6">
          <div className="inline-flex items-center gap-2 rounded-full border bg-secondary px-3 py-1 text-xs font-medium text-secondary-foreground">
            <Car className="h-3.5 w-3.5" /> South Africa · MVP
          </div>
          <h1 className="text-4xl font-semibold leading-tight tracking-tight">Rides made simple.</h1>
          <p className="text-muted-foreground">
            Request a ride in seconds, or earn as a driver. Transparent pricing — a R20 base fare and R13.50 per km.
          </p>
          <div className="flex flex-col gap-3 pt-2">
            <Button size="lg" onClick={() => navigate({ to: "/auth" })}>
              Get started
            </Button>
            <Button
              variant="outline"
              size="lg"
              onClick={() => navigate({ to: "/auth", search: { mode: "signin" } as never })}
            >
              I already have an account
            </Button>
          </div>
        </div>

        <footer className="pt-8 text-center text-xs text-muted-foreground">© {new Date().getFullYear()} Access</footer>
      </div>
    </div>
  );
}

// Avoid `redirect` import warnings
void redirect;
