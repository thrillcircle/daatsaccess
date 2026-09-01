import { describe, expect, it } from "vitest";
import {
  parsePayfastItnEntries,
  payfastItnParameterString,
  payfastItnSignatureInput,
} from "../../../supabase/functions/_shared/payfast-itn-parser";

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

  it("includes every posted ITN field before signature, including empty values", () => {
    const parsed = parsePayfastItnEntries(
      [
        "m_payment_id=DAATS-123",
        "payment_status=COMPLETE",
        "custom_str1=payment-id",
        "custom_str2=",
        "custom_str3=",
        "custom_int1=",
        "custom_int2=",
        "name_first=Vernon",
        "name_last=Baloyi+Passenger",
        "signature=deadbeef",
      ].join("&"),
    );

    expect(payfastItnParameterString(parsed.signedEntries)).toBe(
      "m_payment_id=DAATS-123&payment_status=COMPLETE&custom_str1=payment-id&custom_str2=&custom_str3=&custom_int1=&custom_int2=&name_first=Vernon&name_last=Baloyi+Passenger",
    );
  });

  it("keeps ITN values untrimmed and appends the encoded passphrase only for signature input", () => {
    const entries = [
      ["item_name", " Access payment "],
      ["custom_str1", ""],
    ] as const;

    expect(payfastItnParameterString(entries)).toBe("item_name=+Access+payment+&custom_str1=");
    expect(payfastItnSignatureInput(entries, "jt7NOE43FZPn")).toBe(
      "item_name=+Access+payment+&custom_str1=&passphrase=jt7NOE43FZPn",
    );
  });

  it("keeps all fields signed when no signature field is present", () => {
    const parsed = parsePayfastItnEntries("m_payment_id=DAATS-123&amount_gross=449.30");

    expect(parsed.signature).toBe("");
    expect(parsed.signedEntries).toEqual(parsed.allEntries);
  });
});
