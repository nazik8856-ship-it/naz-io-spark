// General data security, tasks 3 and 4 (docs/cross-platform-boundary.md sections 5-6, docs/connector-trust-boundaries.md).
// These checks fail the build when a boundary is taken out: a customer address that can be aimed at NazAI itself, a sign-in token
// that can leave for an outside host, an outside tool that is shown other tools' memory, or a request body that is not confined.
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const FUNCTIONS = join(__dirname, "../../supabase/functions");
const read = (p: string) => readFileSync(join(FUNCTIONS, p), "utf8");

describe("walls between NazAI, outside tools and user sessions", () => {
  it("a customer address is never NazAI's own project (checked wherever an address is validated, stored or redirected to)", () => {
    const safety = read("_shared/url-safety.ts");
    expect(safety).toMatch(/const itself = ownProjectProblem\(host\);\n\s*if \(itself\) return \{ ok: false, reason: itself \};/);
    // customerFetch and fetchPublicHttps validate every hop with validateOutboundUrl, so a redirect to NazAI is refused too
    expect(safety).toMatch(/const validate = deps\.validate \?\? validateOutboundUrl;/);
  });

  it("the request guard refuses a sign-in or privileged-key token on any request to a host other than NazAI's own project", () => {
    const guard = read("_shared/outbound-guard.ts");
    expect(guard).toMatch(/const session = findSessionToken\(parts, ownHost\);\n\s*if \(session\) \{/);
    expect(guard).toMatch(/const PRIVILEGED_ROLES = new Set\(\["authenticated", "service_role", "supabase_admin"\]\)/);
    // the refusal reaches the security evidence log (it uses the same message shape as a leaked credential)
    expect(guard).toMatch(/carried a NazAI credential \(SESSION_TOKEN\)/);
    expect(read("_shared/security-evidence.ts")).toContain("carried a NazAI credential \\(([A-Z0-9_]{1,80})\\)");
  });
});

describe("a connected tool receives only what its own step needs", () => {
  const session = read("_shared/outer-control-session.ts");

  it("the session engine takes the tool's memory and rules from the share module, and confines the body", () => {
    expect(session).toContain('import { accountIds, confineBody, isExternalTool, sharedMemory } from "./outer-control-share.ts"');
    expect(session).toMatch(/const shown = sharedMemory\(tool, memory, s\.id\);/);
    expect(session).toMatch(/memory: renderMemory\(shown\.memory\)/);
    expect(session).toMatch(/avoid: isExternalTool\(tool\) \? shown\.avoid : plan\.avoid/);
    expect(session).toMatch(/isExternalTool\(tool\) \? \{ \.\.\.built, body: confineBody\(tool\.request_format, built\.body\)\.body \} : built/);
  });

  it("the account's ids are masked out of what is sent and out of what is stored for the step", () => {
    expect(session).toMatch(/const outBody = maskOutbound\(request\.body, \[token, \.\.\.accountIds\(s, tool\)\]\)\.value;/);
  });

  it("the request is never built from the whole Task's memory directly", () => {
    expect(session).not.toMatch(/memory: renderMemory\(memory\)/);
  });

  it("what reaches a step from earlier steps is only what it depends on, and not at all when the hand-off is 'none'", () => {
    const wf = read("_shared/outer-control-workflow.ts");
    expect(wf).toMatch(/const deps = legs\.filter\(\(d\) => leg\.depends_on\.includes\(d\.leg_no\)\);/);
    expect(wf).toMatch(/for \(const d of leg\.handoff_mode === "none" \? \[\] : deps\.filter/);
  });

  it("the share module names the only tools that keep the full view: NazAI's own agent, report writer and starter tools", () => {
    const share = read("_shared/outer-control-share.ts");
    expect(share).toMatch(/!tool\.agent_id && !tool\.endpoint_url\.startsWith\(REPORT_TOOL_URL\) && !isStarterUrl\(tool\.endpoint_url\)/);
  });

  it("every request format has a field allowlist", () => {
    const share = read("_shared/outer-control-share.ts");
    for (const f of ["generic", "openai_chat", "anthropic_messages"]) expect(share).toMatch(new RegExp(`\\b${f}: \\[`));
  });
});
