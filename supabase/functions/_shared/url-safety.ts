// SSRF-safe validation for any URL this platform's own server-side code
// will later fetch() on a schedule or in response to platform events
// (an agent's outbound webhook call, an API key's stuck-decision callback,
// etc). Extracted from agent-runtime's original validateHttpPostUrl/
// isPrivateOrLoopbackIp so every such call site shares one check instead
// of re-deriving (and potentially missing) it independently.

/** The IPv4 address inside an IPv4-mapped / NAT64 / compatible IPv6 address (::ffff:10.0.0.1, ::ffff:a00:1, 64:ff9b::7f00:1), or null. */
function embeddedIpv4(lower: string): string | null {
  const m = lower.match(/^(?:::ffff:|::|64:ff9b::)(?:(\d{1,3}(?:\.\d{1,3}){3})|([0-9a-f]{1,4}):([0-9a-f]{1,4}))$/);
  if (!m) return null;
  if (m[1]) return m[1];
  const hi = parseInt(m[2], 16), lo = parseInt(m[3], 16);
  return `${hi >> 8}.${hi & 255}.${lo >> 8}.${lo & 255}`;
}

export function isPrivateOrLoopbackIp(ip: string): boolean {
  if (ip.includes(":")) {
    const lower = ip.toLowerCase().replace(/^\[|\]$/g, "").split("%")[0];
    if (lower === "::1" || lower === "::") return true;
    // An IPv4 address wrapped in IPv6 is judged as the IPv4 address it carries.
    const inner = embeddedIpv4(lower);
    if (inner !== null) return isPrivateOrLoopbackIp(inner);
    if (lower.startsWith("fe8") || lower.startsWith("fe9") || lower.startsWith("fea") || lower.startsWith("feb")) return true; // link-local fe80::/10
    if (lower.startsWith("fec") || lower.startsWith("fed") || lower.startsWith("fee") || lower.startsWith("fef")) return true; // site-local (deprecated)
    if (lower.startsWith("fc") || lower.startsWith("fd")) return true; // unique-local fc00::/7
    if (lower.startsWith("ff")) return true; // multicast
    if (lower.startsWith("2001:db8")) return true; // documentation
    if (lower.startsWith("64:ff9b:")) return true; // NAT64 other than the forms read above
    return false;
  }
  const parts = ip.split(".").map((n) => parseInt(n, 10));
  if (parts.length !== 4 || parts.some((n) => isNaN(n) || n < 0 || n > 255)) return true;
  const [a, b, c] = parts;
  if (a === 10) return true;
  if (a === 127) return true;
  if (a === 0) return true;
  if (a === 169 && b === 254) return true; // link-local, cloud metadata
  if (a === 172 && b >= 16 && b <= 31) return true;
  if (a === 192 && b === 168) return true;
  if (a === 100 && b >= 64 && b <= 127) return true; // carrier-grade NAT 100.64.0.0/10
  if (a === 192 && b === 0 && c === 0) return true; // IETF protocol assignments
  if (a === 192 && b === 0 && c === 2) return true; // documentation
  if (a === 198 && (b === 18 || b === 19)) return true; // benchmarking 198.18.0.0/15
  if (a === 198 && b === 51 && c === 100) return true; // documentation
  if (a === 203 && b === 0 && c === 113) return true; // documentation
  if (a >= 224) return true; // multicast and reserved
  return false;
}

export type UrlSafetyResult = { ok: boolean; reason: string };

/**
 * https-only, rejects the obvious loopback/link-local hostnames outright,
 * then resolves DNS and checks every A/AAAA record against private/
 * loopback/link-local ranges -- blocks the classic "public hostname that
 * resolves to 169.254.169.254 or an internal 10.x address" DNS-rebinding
 * style SSRF, not just a literal "http://localhost" typed into the field.
 */
export async function validateOutboundUrl(rawUrl: string): Promise<UrlSafetyResult> {
  if (!rawUrl) return { ok: false, reason: "empty url" };
  let u: URL;
  try { u = new URL(rawUrl); } catch { return { ok: false, reason: "invalid url" }; }
  if (u.protocol !== "https:") return { ok: false, reason: "only https is allowed" };
  const host = u.hostname.toLowerCase();
  if (["localhost", "127.0.0.1", "0.0.0.0", "::1", "169.254.169.254"].includes(host)) {
    return { ok: false, reason: `blocked host ${host}` };
  }
  // A host written as an address is judged as that address; it is never looked up.
  const literal = host.replace(/^\[|\]$/g, "");
  if (/^\d{1,3}(\.\d{1,3}){3}$/.test(literal) || literal.includes(":")) {
    return isPrivateOrLoopbackIp(literal) ? { ok: false, reason: `blocked address ${literal}` } : { ok: true, reason: `address ${literal} passed ip checks` };
  }
  try {
    const addrs = await Promise.allSettled([
      Deno.resolveDns(host, "A"),
      Deno.resolveDns(host, "AAAA"),
    ]);
    const ips: string[] = [];
    for (const r of addrs) if (r.status === "fulfilled") ips.push(...r.value);
    if (ips.length === 0) return { ok: false, reason: "dns resolution failed" };
    for (const ip of ips) {
      if (isPrivateOrLoopbackIp(ip)) return { ok: false, reason: `resolved to private/loopback ip ${ip}` };
    }
  } catch (_) {
    return { ok: false, reason: "dns resolution failed" };
  }
  return { ok: true, reason: `host ${host} passed ip checks` };
}
