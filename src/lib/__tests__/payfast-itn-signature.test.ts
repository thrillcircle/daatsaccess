import { beforeAll, describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { createRequire } from "node:module";

// The shared PayFast helper is a Deno edge-function module. Load it here by
// substituting the Deno-only md5 import so the real production logic (not a
// copy) is exercised by these regression tests.
const md5 = createRequire(import.meta.url)("blueimp-md5") as (value: string) => string;

type PayfastEntry = readonly [string, string];
type PayfastModule = {
  parseItnBody: (rawBody: string) => {
    entries: PayfastEntry[];
    data: Record<string, string>;
    signature: string;
    validationBody: string;
  };
  payfastSignature: (entries: readonly PayfastEntry[], passphrase?: string) => string;
  validItnSignature: (
    entries: readonly PayfastEntry[],
    receivedSignature: string,
    passphrase: string,
  ) => boolean;
};

let payfast: PayfastModule;

beforeAll(async () => {
  const source = readFileSync(
    join(process.cwd(), "supabase/functions/_shared/payfast.ts"),
    "utf8",
  ).replace(
    /^import md5 from "npm:blueimp-md5@[^"]+";$/m,
    "const md5 = globalThis.__payfastTestMd5;",
  );

  (globalThis as unknown as { __payfastTestMd5: unknown }).__payfastTestMd5 = md5;

  const { transform } = await import("esbuild");
  const { code } = await transform(source, { loader: "ts", format: "esm" });
  const url = `data:text/javascript;base64,${Buffer.from(code).toString("base64")}`;
  payfast = (await import(/* @vite-ignore */ url)) as PayfastModule;
});

const PASSPHRASE = "jt7NOE43FZPn";

const signedEntries = [
  ["m_payment_id", "DAATS-ad251986ad1047cdab21d5a5c99ab718"],
  ["pf_payment_id", "1234567"],
  ["payment_status", "COMPLETE"],
  ["amount_gross", "350.00"],
  ["merchant_id", "10000100"],
] as const;

function bodyWithTrailingFields(signature: string): string {
  return [
    ...signedEntries.map(([key, value]) => `${key}=${value}`),
    `signature=${signature}`,
    "custom_str9=posted-after-signature",
    "extra_new_payfast_field=should-be-ignored",
  ].join("&");
}

describe("PayFast ITN parameter string construction", () => {
  it("excludes any field posted after the signature field", () => {
    const signature = payfast.payfastSignature(signedEntries, PASSPHRASE);
    const parsed = payfast.parseItnBody(bodyWithTrailingFields(signature));

    expect(parsed.entries.map(([key]) => key)).toEqual([
      "m_payment_id",
      "pf_payment_id",
      "payment_status",
      "amount_gross",
      "merchant_id",
    ]);
    expect(parsed.validationBody).not.toContain("custom_str9");
    expect(parsed.validationBody).not.toContain("extra_new_payfast_field");
    expect(parsed.validationBody).not.toContain("signature=");
  });

  it("retains the complete posted payload in data for lookups and status", () => {
    const signature = payfast.payfastSignature(signedEntries, PASSPHRASE);
    const parsed = payfast.parseItnBody(bodyWithTrailingFields(signature));

    expect(parsed.data.m_payment_id).toBe("DAATS-ad251986ad1047cdab21d5a5c99ab718");
    expect(parsed.data.payment_status).toBe("COMPLETE");
    expect(parsed.data.custom_str9).toBe("posted-after-signature");
    expect(parsed.data.extra_new_payfast_field).toBe("should-be-ignored");
    expect(parsed.signature).toBe(signature);
  });

  it("validates the signature when trailing fields are present", () => {
    const signature = payfast.payfastSignature(signedEntries, PASSPHRASE);
    const parsed = payfast.parseItnBody(bodyWithTrailingFields(signature));
    expect(payfast.validItnSignature(parsed.entries, parsed.signature, PASSPHRASE)).toBe(true);
  });

  it("still rejects a tampered signed field", () => {
    const signature = payfast.payfastSignature(signedEntries, PASSPHRASE);
    const parsed = payfast.parseItnBody(
      bodyWithTrailingFields(signature).replace("350.00", "1.00"),
    );
    expect(payfast.validItnSignature(parsed.entries, parsed.signature, PASSPHRASE)).toBe(false);
  });

  it("rejects a missing signature", () => {
    const parsed = payfast.parseItnBody("merchant_id=10000100&payment_status=COMPLETE");
    expect(parsed.signature).toBe("");
    expect(payfast.validItnSignature(parsed.entries, parsed.signature, PASSPHRASE)).toBe(false);
  });
});
