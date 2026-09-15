// SSRF-safe validation for any URL this platform's own server-side code
// will later fetch() on a schedule or in response to platform events
// (an agent's outbound webhook call, an API key's stuck-decision callback,
// etc). Extracted from agent-runtime's original validateHttpPostUrl/
// isPrivateOrLoopbackIp so every such call site shares one check instead
// of re-deriving (and potentially missing) it independently.

export function isPrivateOrLoopbackIp(ip: string): boolean {
  if (ip.includes(":")) {
    // IPv6: loopback ::1, link-local fe80::/10, unique-local fc00::/7
    const lower = ip.toLowerCase();
    if (lower === "::1" || lower === "::") return true;
    if (lower.startsWith("fe8") || lower.startsWith("fe9") || lower.startsWith("fea") || lower.startsWith("feb")) return true;
    if (lower.startsWith("fc") || lower.startsWith("fd")) return true;
    return false;
  }
  const parts = ip.split(".").map((n) => parseInt(n, 10));
  if (parts.length !== 4 || parts.some((n) => isNaN(n) || n < 0 || n > 255)) return true;
  const [a, b] = parts;
  if (a === 10) return true;
  if (a === 127) return true;
  if (a === 0) return true;
  if (a === 169 && b === 254) return true;
  if (a === 172 && b >= 16 && b <= 31) return true;
  if (a === 192 && b === 168) return true;
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
