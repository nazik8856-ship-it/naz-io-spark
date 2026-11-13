// Outer Control: what a failed connection to a tool really was. "Could not be reached" hid four different problems that need four
// different answers. Pure: the error is read, never sent anywhere, and the wording never repeats the raw error text.

export type NetworkFailureKind = "timeout" | "dns" | "tls" | "refused" | "reset" | "other";

export function networkFailureKind(e: unknown): NetworkFailureKind {
  if (e && typeof e === "object" && (e as { name?: string }).name === "TimeoutError") return "timeout";
  const m = (e instanceof Error ? `${e.message} ${(e as { cause?: { message?: string } }).cause?.message ?? ""}` : String(e ?? "")).toLowerCase();
  if (/dns|lookup|name or service not known|enotfound|no such host|failed to lookup/.test(m)) return "dns";
  if (/certificate|cert |tls|ssl|handshake|unknownissuer|notvalid|self.signed|hostname mismatch/.test(m)) return "tls";
  if (/refused|econnrefused/.test(m)) return "refused";
  if (/reset|econnreset|broken pipe|closed before|unexpected eof|incomplete message/.test(m)) return "reset";
  return "other";
}

/** What to tell the person, and whether asking again could help (a bad certificate or a wrong name will not fix itself). */
export function describeNetworkFailure(kind: NetworkFailureKind): { reason: string; retry: boolean } {
  switch (kind) {
    case "timeout": return { reason: "The tool did not answer in time.", retry: true };
    case "dns": return { reason: "The address could not be found: the name does not exist or its DNS is not set up. Check the address for a typo.", retry: true };
    case "tls": return { reason: "The tool's security certificate is not valid (expired, self-signed or for another name). Outer Control only contacts tools with a valid HTTPS certificate.", retry: false };
    case "refused": return { reason: "The tool's server refused the connection. It may be down, or the address or port is wrong.", retry: true };
    case "reset": return { reason: "The connection to the tool was cut off while it was answering.", retry: true };
    default: return { reason: "The tool could not be reached.", retry: true };
  }
}
