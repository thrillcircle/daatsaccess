import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const hotfix = readFileSync(
  resolve(
    process.cwd(),
    "supabase/migrations/20260731112000_phase4_passenger_quote_response_privacy.sql",
  ),
  "utf8",
);

function functionBody(name: string): string {
  const start = hotfix.indexOf(`CREATE OR REPLACE FUNCTION ${name}`);
  expect(start).toBeGreaterThanOrEqual(0);
  const next = hotfix.indexOf("CREATE OR REPLACE FUNCTION", start + 1);
  return hotfix.slice(start, next === -1 ? hotfix.length : next);
}

describe("Phase 4 passenger quote mutation privacy", () => {
  it("returns only a customer-safe quote projection", () => {
    const response = functionBody("private.passenger_quote_action_response");

    expect(response).toContain("'quote_reference', p_quote.quote_reference");
    expect(response).toContain("'final_total', p_quote.final_total");
    expect(response).toContain("'deposit_amount', p_quote.deposit_amount_snapshot");
    expect(response).toContain("'row_version', p_quote.row_version");

    expect(response).not.toContain("calculation_snapshot");
    expect(response).not.toContain("margin_amount");
    expect(response).not.toContain("adjustments_total");
    expect(response).not.toContain("admin_override_reason");
    expect(response).not.toContain("internal_explanation");
  });

  it("uses the safe projection for every accept and decline outcome", () => {
    const accept = functionBody("public.passenger_accept_service_quote");
    const decline = functionBody("public.passenger_decline_service_quote");

    expect(accept).toContain("private.passenger_quote_action_response");
    expect(accept).not.toContain("jsonb_build_object('quote', to_jsonb(v_quote)");
    expect(decline).toContain("private.passenger_quote_action_response");
    expect(decline).not.toContain("jsonb_build_object('quote', to_jsonb(v_quote)");
  });

  it("sanitizes previously stored acceptance idempotency results", () => {
    expect(hotfix).toContain("UPDATE public.pricing_operation_requests request");
    expect(hotfix).toContain("request.operation_type = 'accept_service_quote'");
    expect(hotfix).toContain("DO UPDATE SET result = EXCLUDED.result");
  });

  it("keeps the response helper inaccessible to ordinary clients", () => {
    expect(hotfix).toContain(
      "FROM PUBLIC, anon, authenticated;\nGRANT EXECUTE ON FUNCTION private.passenger_quote_action_response",
    );
    expect(hotfix).toContain("TO service_role;");
  });
});
