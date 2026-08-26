// "15 more items" plan, item 10: give the public Control API a version
// marker before any real outside customer depends on its current shape --
// the cheapest time to add this is before it matters. A bare
// /control-api URL (no version segment) is treated as an alias for
// today's only version, CONTROL_API_VERSION, so nothing already using it
// breaks; a request that explicitly names a DIFFERENT version (e.g.
// /control-api/v2) is rejected outright rather than silently served by
// v1's current behavior -- so a real future v2 has room to actually
// change shape without this endpoint pretending to support it today.
export const CONTROL_API_VERSION = "v1";

export type ApiVersionCheck = { ok: true } | { ok: false; requested: string };

export function checkApiVersion(pathname: string, supported: string = CONTROL_API_VERSION): ApiVersionCheck {
  const match = pathname.match(/\/control-api\/(v\d+)(?:\/|$)/);
  if (!match) return { ok: true };
  if (match[1] === supported) return { ok: true };
  return { ok: false, requested: match[1] };
}
