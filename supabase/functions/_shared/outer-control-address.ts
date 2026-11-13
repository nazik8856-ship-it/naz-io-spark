// Outer Control: what counts as NazAI's own address when someone connects a tool (docs/outer-control-tools.md).
// An outside tool is a service somewhere else. NazAI's own projects (its server, its website, the agents and sites built on it) are
// not outside tools: aimed at them, a request would be NazAI talking to itself. They are connected the NazAI way instead
// (Add a NazAI agent), which needs no address and no key.
// The same rule is repeated in src/lib/outer-control-tools-ui.ts for the form; src/test/outer-control-address.test.ts checks the two agree.

/** NazAI's website (and every name under it). */
export const NAZAI_SITE_HOSTS: readonly string[] = ["nazai.net"];

export const NAZAI_ADDRESS_HELP = "That is a NazAI address. NazAI's own projects are not connected as outside tools: to use one of your agents in a Task choose Add a NazAI agent. Put an outside tool's own address here.";

const cleanHost = (h: string) => h.toLowerCase().replace(/\.$/, "");

export function isNazaiSiteHost(host: string): boolean {
  const h = cleanHost(host);
  return NAZAI_SITE_HOSTS.some((s) => h === s || h.endsWith(`.${s}`));
}

/** Why this address can not be an outside tool because it is NazAI's own, or null. `ownHost` is the host of NazAI's own server. */
export function nazaiAddressProblem(rawUrl: string, ownHost: string | null): string | null {
  let host: string;
  try { host = cleanHost(new URL(rawUrl).hostname); } catch { return null; } // a malformed address is reported by the address check
  if (ownHost && host === cleanHost(ownHost)) return NAZAI_ADDRESS_HELP;
  if (isNazaiSiteHost(host)) return NAZAI_ADDRESS_HELP;
  return null;
}

/** Built into NazAI, never an outside connection: the report writer, NazAI's starter AI, and the account's own agents. */
export const isBuiltInEndpoint = (endpoint: unknown): boolean =>
  typeof endpoint === "string" && (endpoint.startsWith("nazai-internal://") || endpoint.startsWith("nazai-agent://"));
