import md5 from "npm:blueimp-md5@2.19.0";

export type PayfastMode = "sandbox" | "live";

export type PayfastConfig = {
  mode: PayfastMode;
  merchantId: string;
  merchantKey: string;
  passphrase: string;
  checkoutUrl: string;
  validationUrl: string;
};

// PayFast's documentation-provided test merchant. These credentials are for
// Sandbox only and must never be used as live merchant credentials.
const DOCUMENTATION_SANDBOX = {
  merchantId: "10000100",
  merchantKey: "46f0cd694581a",
  passphrase: "jt7NOE43FZPn",
  checkoutUrl: "https://sandbox.payfast.co.za/eng/process",
  validationUrl: "https://sandbox.payfast.co.za/eng/query/validate",
} as const;

const LIVE_URLS = {
  checkoutUrl: "https://www.payfast.co.za/eng/process",
  validationUrl: "https://www.payfast.co.za/eng/query/validate",
} as const;

function requiredEnv(name: string): string {
  const value = Deno.env.get(name)?.trim();
  if (!value) throw new Error(`${name} is required in live PayFast mode`);
  return value;
}

export function getPayfastConfig(): PayfastConfig {
  const rawMode = (Deno.env.get("PAYFAST_MODE") ?? "sandbox").trim().toLowerCase();
  if (rawMode !== "sandbox" && rawMode !== "live") {
    throw new Error("PAYFAST_MODE must be either sandbox or live");
  }

  if (rawMode === "sandbox") {
    return {
      mode: "sandbox",
      merchantId:
        Deno.env.get("PAYFAST_SANDBOX_MERCHANT_ID")?.trim() ||
        DOCUMENTATION_SANDBOX.merchantId,
      merchantKey:
        Deno.env.get("PAYFAST_SANDBOX_MERCHANT_KEY")?.trim() ||
        DOCUMENTATION_SANDBOX.merchantKey,
      passphrase:
        Deno.env.get("PAYFAST_SANDBOX_PASSPHRASE")?.trim() ||
        DOCUMENTATION_SANDBOX.passphrase,
      checkoutUrl: DOCUMENTATION_SANDBOX.checkoutUrl,
      validationUrl: DOCUMENTATION_SANDBOX.validationUrl,
    };
  }

  return {
    mode: "live",
    merchantId: requiredEnv("PAYFAST_MERCHANT_ID"),
    merchantKey: requiredEnv("PAYFAST_MERCHANT_KEY"),
    passphrase: requiredEnv("PAYFAST_PASSPHRASE"),
    ...LIVE_URLS,
  };
}

/** PHP urlencode-compatible encoding used by PayFast's custom integration. */
export function payfastEncode(value: string): string {
  return encodeURIComponent(value.trim())
    .replace(/%20/g, "+")
    .replace(/[!'()*~]/g, (character) =>
      `%${character.charCodeAt(0).toString(16).toUpperCase()}`,
    );
}

export type PayfastEntry = readonly [string, string];

export function payfastParameterString(
  entries: readonly PayfastEntry[],
  passphrase?: string,
): string {
  const parts = entries
    .filter(([, value]) => value !== "")
    .map(([key, value]) => `${key}=${payfastEncode(value)}`);

  if (passphrase) {
    parts.push(`passphrase=${payfastEncode(passphrase)}`);
  }

  return parts.join("&");
}

export function payfastSignature(
  entries: readonly PayfastEntry[],
  passphrase?: string,
): string {
  return md5(payfastParameterString(entries, passphrase));
}

export function checkoutFields(
  entries: readonly PayfastEntry[],
  passphrase: string,
): Record<string, string> {
  const fields = Object.fromEntries(entries.filter(([, value]) => value !== ""));
  return {
    ...fields,
    signature: payfastSignature(entries, passphrase),
  };
}

export function parseItnBody(rawBody: string): {
  entries: PayfastEntry[];
  data: Record<string, string>;
  signature: string;
  validationBody: string;
} {
  const search = new URLSearchParams(rawBody);
  const allEntries = Array.from(search.entries()) as PayfastEntry[];
  const signature = search.get("signature") ?? "";
  const entries = allEntries.filter(([key]) => key !== "signature");

  return {
    entries,
    data: Object.fromEntries(allEntries),
    signature,
    validationBody: payfastParameterString(entries),
  };
}

export function validItnSignature(
  entries: readonly PayfastEntry[],
  receivedSignature: string,
  passphrase: string,
): boolean {
  if (!receivedSignature) return false;
  return payfastSignature(entries, passphrase) === receivedSignature.toLowerCase();
}

export function amountMatches(expected: number, received: number): boolean {
  return Number.isFinite(expected) && Number.isFinite(received) && Math.abs(expected - received) <= 0.01;
}

// Current PayFast server ranges published in the integration documentation.
// Keep this list aligned with PayFast's Ports and IP addresses section.
export const PAYFAST_IPV4_CIDRS = [
  "197.97.145.144/28",
  "41.74.179.192/27",
  "102.216.36.0/28",
  "102.216.36.128/28",
  "144.126.193.139/32",
] as const;

function normalizeIpv4(value: string): string | null {
  const first = value.split(",")[0]?.trim() ?? "";
  const normalized = first.startsWith("::ffff:") ? first.slice(7) : first;
  const parts = normalized.split(".");
  if (parts.length !== 4) return null;
  const octets = parts.map(Number);
  if (octets.some((octet) => !Number.isInteger(octet) || octet < 0 || octet > 255)) {
    return null;
  }
  return normalized;
}

function ipv4ToInt(ip: string): number {
  return ip
    .split(".")
    .map(Number)
    .reduce((result, octet) => ((result << 8) | octet) >>> 0, 0);
}

function cidrContains(ip: string, cidr: string): boolean {
  const [network, prefixText] = cidr.split("/");
  if (!network || !prefixText) return false;
  const prefix = Number(prefixText);
  if (!Number.isInteger(prefix) || prefix < 0 || prefix > 32) return false;

  const mask = prefix === 0 ? 0 : (0xffffffff << (32 - prefix)) >>> 0;
  return (ipv4ToInt(ip) & mask) === (ipv4ToInt(network) & mask);
}

export function isPayfastSourceIp(value: string | null | undefined): boolean {
  if (!value) return false;
  const ip = normalizeIpv4(value);
  if (!ip) return false;
  return PAYFAST_IPV4_CIDRS.some((cidr) => cidrContains(ip, cidr));
}

export async function sha256Hex(value: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value));
  return Array.from(new Uint8Array(digest))
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
}

export function sanitizedItnPayload(data: Record<string, string>): Record<string, string> {
  const clone = { ...data };
  delete clone.signature;
  return clone;
}
