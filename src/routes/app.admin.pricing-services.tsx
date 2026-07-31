import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useEffect } from "react";
import { AdminShell } from "@/components/AdminShell";
import { PricingVersionManager } from "@/components/pricing/PricingVersionManager";
import { useAuth, useUserRoles } from "@/hooks/use-auth";

export const Route = createFileRoute("/app/admin/pricing-services")({
  head: () => ({ meta: [{ title: "Pricing & Services — Admin" }] }),
  component: PricingServicesPage,
});

function PricingServicesPage() {
  const { user, loading: authLoading } = useAuth();
  const { roles, loading: rolesLoading } = useUserRoles(user?.id);
  const navigate = useNavigate();
  const isAdmin = !!roles?.includes("admin");

  useEffect(() => {
    if (authLoading || rolesLoading || roles === null) return;
    if (!user || !isAdmin) navigate({ to: "/app" });
  }, [authLoading, rolesLoading, roles, user, isAdmin, navigate]);

  if (authLoading || rolesLoading || (user && roles === null)) {
    return (
      <AdminShell title="Pricing & Services">
        <p className="text-sm text-muted-foreground">Loading…</p>
      </AdminShell>
    );
  }
  if (!isAdmin) return null;

  return (
    <AdminShell
      title="Pricing & Services"
      subtitle="Create, validate, compare and publish effective-dated pricing versions. Published versions are immutable."
    >
      <PricingVersionManager />
    </AdminShell>
  );
}
