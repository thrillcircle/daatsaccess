export type PayfastItnEntry = readonly [string, string];

export type ParsedPayfastItn = {
  allEntries: PayfastItnEntry[];
  signedEntries: PayfastItnEntry[];
  data: Record<string, string>;
  signature: string;
};

/** PHP urlencode-compatible encoding for PayFast ITN values.
 *
 * Unlike checkout signing, ITN validation must preserve the posted value
 * exactly and must not trim it before encoding.
 */
export function payfastItnEncode(value: string): string {
  return encodeURIComponent(value)
    .replace(/%20/g, "+")
    .replace(/[!'()*~]/g, (character) =>
      `%${character.charCodeAt(0).toString(16).toUpperCase()}`,
    );
}

/**
 * Build the PayFast notification parameter string exactly as their official
 * validator does: preserve posted order, include empty values, and omit only
 * the signature field (the parser already stops before it).
 */
export function payfastItnParameterString(entries: readonly PayfastItnEntry[]): string {
  return entries.map(([key, value]) => `${key}=${payfastItnEncode(value)}`).join("&");
}

export function payfastItnSignatureInput(
  entries: readonly PayfastItnEntry[],
  passphrase?: string,
): string {
  const body = payfastItnParameterString(entries);
  return passphrase ? `${body}&passphrase=${payfastItnEncode(passphrase)}` : body;
}

/**
 * Parse a PayFast ITN while preserving the provider's posted field order.
 *
 * PayFast's ITN reference implementation stops constructing the signed
 * parameter string when it reaches the `signature` field. Fields posted after
 * `signature` remain part of the notification payload, but must not be included
 * in signature or server-confirmation validation.
 */
export function parsePayfastItnEntries(rawBody: string): ParsedPayfastItn {
  const search = new URLSearchParams(rawBody);
  const allEntries = Array.from(search.entries()) as PayfastItnEntry[];
  const signatureIndex = allEntries.findIndex(([key]) => key === "signature");
  const signedEntries = signatureIndex === -1 ? allEntries : allEntries.slice(0, signatureIndex);

  return {
    allEntries,
    signedEntries,
    data: Object.fromEntries(allEntries),
    signature: search.get("signature") ?? "",
  };
}
