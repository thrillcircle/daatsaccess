import { describe, expect, it } from "vitest";
import { parsePayfastItnEntries } from "../../../supabase/functions/_shared/payfast-itn-parser";

describe("PayFast ITN parser", () => {
  it("stops signed fields at signature but retains later payload fields", () => {
    const raw = [
      "m_payment_id=DAATS-123",
      "pf_payment_id=3360411",
      "amount_gross=449.30",
      "signature=deadbeef",
      "custom_str1=payment-id",
      "payment_status=COMPLETE",
    ].join("&");

    const parsed = parsePayfastItnEntries(raw);

    expect(parsed.signature).toBe("deadbeef");
    expect(parsed.signedEntries).toEqual([
      ["m_payment_id", "DAATS-123"],
      ["pf_payment_id", "3360411"],
      ["amount_gross", "449.30"],
    ]);
    expect(parsed.data.custom_str1).toBe("payment-id");
    expect(parsed.data.payment_status).toBe("COMPLETE");
  });

  it("keeps all fields signed when no signature field is present", () => {
    const parsed = parsePayfastItnEntries("m_payment_id=DAATS-123&amount_gross=449.30");

    expect(parsed.signature).toBe("");
    expect(parsed.signedEntries).toEqual(parsed.allEntries);
  });
});
