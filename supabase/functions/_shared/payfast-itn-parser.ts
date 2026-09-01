export type ParsedPayfastItn = {
  allEntries: Array<readonly [string, string]>;
  signedEntries: Array<readonly [string, string]>;
  data: Record<string, string>;
  signature: string;
};

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
  const allEntries = Array.from(search.entries()) as Array<readonly [string, string]>;
  const signatureIndex = allEntries.findIndex(([key]) => key === "signature");
  const signedEntries = signatureIndex === -1 ? allEntries : allEntries.slice(0, signatureIndex);

  return {
    allEntries,
    signedEntries,
    data: Object.fromEntries(allEntries),
    signature: search.get("signature") ?? "",
  };
}
