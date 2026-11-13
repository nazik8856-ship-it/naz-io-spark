// Tool address and connection logic (docs/outer-control-tools.md): NazAI's own projects are not outside tools, and a failed
// connection says what really failed.
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import * as server from "../../supabase/functions/_shared/outer-control-address";
import { describeNetworkFailure, networkFailureKind } from "../../supabase/functions/_shared/network-failure";
import * as ui from "@/lib/outer-control-tools-ui";
import { OWN_SERVER_HOST } from "@/lib/server-host";

const OWN = "ekuodpaaiugzywfcmjeo.supabase.co";
const ROOT = join(__dirname, "../..");

describe("NazAI's own address is not an outside tool", () => {
  const nazai = [
    `https://${OWN}/functions/v1/outer-control-stub-tool`, "https://nazai.net/api/x", "https://www.nazai.net/", "https://my-site.nazai.net/hook", "https://NAZAI.NET./x",
  ];
  const outside = ["https://api.openai.com/v1/chat/completions", "https://example.com/hook", "https://notnazai.net/x", "https://nazai.net.evil.com/x", "https://nazai-net.example.com/"];

  it("the server refuses them, with what to do instead", () => {
    for (const u of nazai) expect(server.nazaiAddressProblem(u, OWN), u).toBe(server.NAZAI_ADDRESS_HELP);
    expect(server.NAZAI_ADDRESS_HELP).toMatch(/Add a NazAI agent/);
  });
  it("outside tools, and look-alike names, pass", () => {
    for (const u of outside) expect(server.nazaiAddressProblem(u, OWN), u).toBeNull();
  });
  it("a malformed address is left to the address check", () => {
    expect(server.nazaiAddressProblem("not a url", OWN)).toBeNull();
  });
  it("the form follows the same rule as the server, for every example", () => {
    for (const u of [...nazai, ...outside, "not a url"]) expect(ui.nazaiAddressProblem(u, OWN), u).toBe(server.nazaiAddressProblem(u, OWN));
    expect(ui.NAZAI_SITE_HOSTS).toEqual(server.NAZAI_SITE_HOSTS);
    expect(ui.NAZAI_ADDRESS_HELP).toBe(server.NAZAI_ADDRESS_HELP);
  });
  it("the connect form shows the problem before anything is sent", () => {
    const d = { name: "My agent", url: `https://${OWN}/functions/v1/agent-runtime`, format: "generic_json", token: "", model: "" };
    expect(ui.checkConnector(d, OWN_SERVER_HOST).errors).toContain(server.NAZAI_ADDRESS_HELP);
    expect(ui.checkConnector({ ...d, url: "https://example.com/hook" }, OWN).errors).toEqual([]);
  });
  it("the form's idea of NazAI's own server is the real one", () => {
    expect(OWN_SERVER_HOST).toBe(OWN);
    expect(readFileSync(join(ROOT, "src/integrations/supabase/client.ts"), "utf8")).toContain(`https://${OWN_SERVER_HOST}`);
  });
  it("the tool is checked before the test, the session and the save", () => {
    const read = (p: string) => readFileSync(join(ROOT, p), "utf8");
    expect(read("supabase/functions/outer-control-drive/index.ts")).toContain("nazaiAddressProblem(endpoint, ownProjectHost())");
    expect(read("supabase/functions/_shared/outer-control-tool-test.ts")).toContain("nazaiAddressProblem(tool.endpoint_url, ownProjectHost())");
    expect(read("supabase/functions/_shared/outer-control-session.ts")).toContain("nazaiAddressProblem(tool.endpoint_url, ownProjectHost())");
  });
});

describe("built-in tools are not 'not tested yet'", () => {
  const base = { approved_at: null, last_ok_at: null, last_checked_at: null, last_error: null };
  it("an agent, the report writer and the starter AI are Built in", () => {
    for (const e of ["nazai-agent://abc", "nazai-internal://report", "nazai-internal://starter/1"]) {
      expect(ui.toolHealth({ ...base, endpoint_url: e })).toMatchObject({ key: "working", label: "Built in" });
      expect(ui.isBuiltInTool(e)).toBe(true);
      expect(server.isBuiltInEndpoint(e)).toBe(true);
    }
  });
  it("an outside tool that was never tested still needs a test, and a built-in one that failed still shows the failure", () => {
    expect(ui.toolHealth({ ...base, endpoint_url: "https://example.com/x" }).key).toBe("attention");
    const failed = ui.toolHealth({ ...base, endpoint_url: "nazai-agent://abc", last_checked_at: "2026-11-13T00:00:00Z", last_error: "The agent no longer exists." });
    expect(failed).toMatchObject({ key: "failed", reason: "The agent no longer exists." });
    expect(ui.isBuiltInTool("https://example.com")).toBe(false);
  });
});

describe("a failed connection says what failed", () => {
  const err = (m: string, cause?: string) => Object.assign(new TypeError(m), cause ? { cause: new Error(cause) } : {});
  it("reads the kind from the error", () => {
    expect(networkFailureKind(err("error sending request for url (https://x): client error (Connect): dns error: failed to lookup address information: Name or service not known"))).toBe("dns");
    expect(networkFailureKind(err("error sending request", "invalid peer certificate: UnknownIssuer"))).toBe("tls");
    expect(networkFailureKind(err("error sending request", "certificate has expired"))).toBe("tls");
    expect(networkFailureKind(err("client error (Connect): tcp connect error: Connection refused (os error 111)"))).toBe("refused");
    expect(networkFailureKind(err("connection reset by peer"))).toBe("reset");
    expect(networkFailureKind(Object.assign(new Error("t"), { name: "TimeoutError" }))).toBe("timeout");
    expect(networkFailureKind(new Error("something odd"))).toBe("other");
    expect(networkFailureKind(null)).toBe("other");
  });
  it("each kind has its own wording, and never repeats the raw error", () => {
    const texts = (["timeout", "dns", "tls", "refused", "reset", "other"] as const).map((k) => describeNetworkFailure(k).reason);
    expect(new Set(texts).size).toBe(6);
    expect(describeNetworkFailure("tls").retry).toBe(false);
    expect(describeNetworkFailure("dns").reason).toMatch(/typo/);
    for (const t of texts) expect(t).not.toMatch(/os error|UnknownIssuer|https?:\/\//);
  });
});

describe("wording and retries (server modules)", () => {
  const load = async () => {
    (globalThis as unknown as { Deno?: unknown }).Deno ??= { env: { get: () => undefined } };
    // A path built at run time: the type-check must not read the server code (it uses Deno).
    const at = (f: string) => join(ROOT, "supabase/functions/_shared", f);
    const recovery = await import(/* @vite-ignore */ at("outer-control-recovery.ts"));
    const tool = await import(/* @vite-ignore */ at("outer-control-tool-test.ts"));
    return { classifyFailure: recovery.classifyFailure, describeHttpFailure: tool.describeHttpFailure };
  };
  it("the HTTP wording covers the common refusals", async () => {
    const { describeHttpFailure } = await load();
    expect(describeHttpFailure(400)).toMatch(/request format and the model name/);
    expect(describeHttpFailure(402)).toMatch(/no credit/);
    expect(describeHttpFailure(404)).toBe("Nothing answers at that address (HTTP 404). Check the address.");
    expect(describeHttpFailure(415)).toMatch(/format/);
    expect(describeHttpFailure(401)).toMatch(/rejected the key/);
  });
  it("during a Task: a bad certificate is not retried; a refused connection is, with its own reason", async () => {
    const { classifyFailure } = await load();
    const tls = classifyFailure({ httpStatus: null, unreachable: true, networkKind: "tls", attempt: 1 });
    expect(tls).toMatchObject({ retry: false, kind: "unusable" });
    expect(tls.reason).toMatch(/certificate/);
    const refused = classifyFailure({ httpStatus: null, unreachable: true, networkKind: "refused", attempt: 1 });
    expect(refused).toMatchObject({ retry: true, kind: "transient" });
    expect(refused.reason).toMatch(/refused/);
    expect(classifyFailure({ httpStatus: null, unreachable: true, attempt: 1 }).reason).toBe("The tool could not be reached.");
  });
});

describe("the keep-alive tests only real outside tools", () => {
  const src = readFileSync(join(ROOT, "supabase/functions/_shared/outer-control-keepalive.ts"), "utf8");
  it("leaves out agents, the report writer and the starter AI, removed and disabled tools, and untested approvals", () => {
    expect(src).toContain('.is("agent_id", null)');
    expect(src).toContain('.not("endpoint_url", "like", "nazai-internal://%")');
    expect(src).toContain('.eq("enabled", true).is("removed_at", null)');
    expect(src).toContain('.not("approved_at", "is", null)');
  });
  it("a tool with NazAI's own address is reported without any request, so the keep-alive never contacts NazAI itself", () => {
    const test = readFileSync(join(ROOT, "supabase/functions/_shared/outer-control-tool-test.ts"), "utf8");
    expect(test.indexOf("nazaiAddressProblem(")).toBeGreaterThan(0);
    expect(test.indexOf("nazaiAddressProblem(")).toBeLessThan(test.indexOf("deps.fetchImpl(tool.endpoint_url"));
    expect(test.indexOf("nazaiAddressProblem(")).toBeLessThan(test.indexOf("deps.validateUrl(tool.endpoint_url)"));
  });
});
