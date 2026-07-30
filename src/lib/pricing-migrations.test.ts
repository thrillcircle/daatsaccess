import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const migration = (name: string) =>
  readFileSync(resolve(process.cwd(), "supabase/migrations", name), "utf8");

const source = (name: string) => readFileSync(resolve(process.cwd(), "src", name), "utf8");

const legacyPricing = migration("20260730173000_phase1_service_pricing_rules.sql");
const legacyReconciliation = migration("20260730231400_phase4_legacy_quote_reconciliation.sql");
const quoteStatuses = migration("20260730231450_phase4_quote_status_values.sql");
const foundation = migration("20260730231500_phase4_pricing_quotations.sql");
const privacy = migration("20260730232500_phase4_quote_privacy.sql");
const estimates = migration("20260730233500_phase4_server_estimates.sql");
const security = migration("20260730234500_phase4_pricing_security_closeout.sql");
const integrity = migration("20260730234700_phase4_integrity_hardening.sql");
const clientBoundary = migration("20260730234800_phase4_client_financial_boundary.sql");
const extendedJourneyAdmin = source("components/ExtendedJourneyAdmin.tsx");

describe("Phase 4 database contracts", () => {
  it("preserves confirmed Ride and Transport pricing as published version 1", () => {
    expect(legacyPricing).toContain("('ride', 20.00, 13.50");
    expect(legacyPricing).toContain("('transport', 20.00, 13.50");
    expect(foundation).toContain("FROM public.service_pricing_rules legacy");
    expect(foundation).toContain("CASE WHEN legacy.service_type IN ('ride', 'transport')");
  });

  it("reconciles legacy quote revisions and lifecycle before unique constraints", () => {
    expect(legacyReconciliation).toContain("row_number() OVER");
    expect(legacyReconciliation).toContain("superseded_by_quote_id");
    expect(quoteStatuses).toContain("ADD VALUE IF NOT EXISTS 'superseded'");
    expect(quoteStatuses).toContain("ADD VALUE IF NOT EXISTS 'cancelled'");
  });

  it("keeps mock specialised pricing from being published", () => {
    expect(foundation).toContain(
      "IF v_version.is_mock THEN RAISE EXCEPTION 'Mock pricing cannot be published'",
    );
  });

  it("blocks direct quote writes and customer access to internal quote rows", () => {
    expect(foundation).toContain("REVOKE INSERT, UPDATE, DELETE ON public.pricing_versions");
    expect(privacy).toContain(
      "REVOKE SELECT ON public.service_quotes, public.service_quote_items FROM authenticated",
    );
    expect(privacy).toContain("WHERE quote.booking_id = p_booking_id AND item.customer_visible");
  });

  it("keeps the internal calculation RPC away from ordinary authenticated clients", () => {
    expect(security).toContain(
      "REVOKE ALL ON FUNCTION public.pricing_calculate(text, jsonb, timestamptz, uuid)",
    );
    expect(security).toContain("GRANT EXECUTE ON FUNCTION public.admin_pricing_calculate");
    expect(security).not.toMatch(
      /GRANT EXECUTE ON FUNCTION public\.pricing_calculate\(text, jsonb, timestamptz, uuid\)\s+TO authenticated/,
    );
  });

  it("enforces published-version overlap and sent-snapshot immutability", () => {
    expect(security).toContain("pricing_versions_no_published_overlap");
    expect(security).toContain("Published or retired pricing components are immutable");
    expect(security).toContain("Sent quote calculation snapshots are immutable");
    expect(security).toContain("Sent quote items are immutable");
  });

  it("requires passenger Ride and Transport creation to use priced RPCs", () => {
    expect(estimates).toContain("CREATE OR REPLACE FUNCTION public.passenger_create_priced_ride");
    expect(estimates).toContain(
      "CREATE OR REPLACE FUNCTION public.passenger_create_transport_booking",
    );
    expect(estimates).toContain('DROP POLICY IF EXISTS "passenger creates ride"');
    expect(estimates).toContain("pricing_version_id, estimate_snapshot");
  });

  it("supports quote expiry, deposits and linked notifications", () => {
    expect(security).toContain("CREATE OR REPLACE FUNCTION public.pricing_expire_due_quotes");
    expect(security).toContain("CREATE OR REPLACE FUNCTION public.admin_set_quote_deposit");
    expect(security).toContain("CREATE OR REPLACE FUNCTION public.notify_quote_sent");
  });

  it("validates publications and protects authoritative booking totals", () => {
    expect(integrity).toContain("CREATE OR REPLACE FUNCTION public.admin_validate_pricing_version");
    expect(integrity).toContain("pricing_validate_version_internal");
    expect(integrity).toContain("Booking pricing and deposit fields are server-authoritative");
    expect(integrity).toContain("REVOKE INSERT, UPDATE, DELETE ON public.service_pricing_rules");
  });

  it("supports draft recalculation, cancellation and committed expiry outcomes", () => {
    expect(integrity).toContain(
      "CREATE OR REPLACE FUNCTION public.admin_recalculate_service_quote",
    );
    expect(integrity).toContain("CREATE OR REPLACE FUNCTION public.admin_cancel_service_quote");
    expect(integrity).toContain("'accepted', false, 'reason', 'expired'");
    expect(integrity).toContain("'declined', false, 'reason', 'expired'");
  });

  it("blocks authenticated admin browsers from bypassing protected financial RPCs", () => {
    expect(clientBoundary).toContain(
      "Only database-owned or service-role execution may change the",
    );
    expect(clientBoundary).not.toContain("private.has_role(auth.uid(), 'admin'::app_role)");
    expect(clientBoundary).toContain(
      "Booking pricing and deposit fields are server-authoritative",
    );
    expect(extendedJourneyAdmin).not.toContain("deposit_amount:");
    expect(extendedJourneyAdmin).not.toContain("Save deposit");
    expect(extendedJourneyAdmin).toContain("Open quote workspace");
  });
});
