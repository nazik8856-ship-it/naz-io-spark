// General data security, tasks 6 and 7: compromise containment (docs/compromise-containment.md) and what is recorded of it
// (docs/security-evidence.md).
//
// These checks fail the build when an unsafe tool can be contacted again after it was suspended, when the two ways of stopping a tool's
// work drift apart, when a suspended tool can be started by another route, or when a kind of evidence is added in the code but not in
// the database (or the other way round).
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const ROOT = join(__dirname, "../..");
const FN = join(ROOT, "supabase/functions");
const read = (p: string) => readFileSync(join(FN, p), "utf8");
const migration = readFileSync(join(ROOT, "supabase/migrations/20261110024754_containment_and_auditability.sql"), "utf8");
const doc = (n: string) => readFileSync(join(ROOT, "docs", n), "utf8");

describe("one tool is stopped, the rest keeps running", () => {
  it("removal and suspension close a tool's work through the same function", () => {
    expect(read("_shared/outer-control-tools.ts")).toContain("export async function stopToolWork(");
    expect(read("_shared/outer-control-tools.ts")).toMatch(/removeTool[\s\S]*stopToolWork\(admin, accountId, toolId/);
    expect(read("_shared/outer-control-containment.ts")).toContain("stopToolWork(admin, o.userId, o.toolId");
  });

  it("suspending takes the first-contact approval back and only applies to a tool that is not suspended yet", () => {
    const src = read("_shared/outer-control-containment.ts");
    expect(src).toContain("approved_at: null");
    expect(src).toContain('.is("suspended_at", null)');
    expect(src).toContain('.is("agent_id", null)');
  });

  it("the session engine never contacts a suspended tool, and checks the signals at both points a tool can show it is unsafe", () => {
    const src = read("_shared/outer-control-session.ts");
    const gate = src.indexOf("if (tool.suspended_at)");
    const approval = src.indexOf("if (!tool.approved_at)");
    expect(gate).toBeGreaterThan(0);
    expect(gate).toBeLessThan(approval);
    expect((src.match(/containIfUnsafe\(/g) ?? []).length).toBe(2);
    expect(src).toMatch(/outboundRefused && isExternalTool\(tool\)/);
    expect(src).toMatch(/contained\.status === "quarantined" && isExternalTool\(tool\)/);
  });

  it("no other route starts, tests or fills a Task with a suspended tool", () => {
    const drive = read("outer-control-drive/index.ts");
    expect((drive.match(/suspended_at/g) ?? []).length).toBeGreaterThanOrEqual(5);
    expect(read("_shared/outer-control-workflow.ts").match(/suspended_at/g)?.length).toBeGreaterThanOrEqual(3);
  });

  it("only the owner resumes a tool, through the signed-in function, and the first-contact approval stays taken back", () => {
    expect(read("outer-control-drive/index.ts")).toMatch(/action === "resume_tool"[\s\S]{0,200}resumeTool\(admin, accountId/);
    const src = read("_shared/outer-control-containment.ts");
    const resume = src.slice(src.indexOf("export async function resumeTool("));
    expect(resume).not.toContain("approved_at");
    expect(resume).toContain('actor: "user"');
  });

  it("the owner is told when a tool is suspended, as an incident", () => {
    expect(read("_shared/critical-alerts.ts")).toContain('"outer_control_tool_suspended"');
    expect(read("_shared/incidents.ts")).toContain('"outer_control_tool_suspended"');
    expect(read("_shared/outer-control-session.ts")).toContain('event: "outer_control_tool_suspended"');
  });

  it("the website shows a suspended tool and offers Resume instead of Test and Start", () => {
    const ui = readFileSync(join(ROOT, "src/components/control/outer/ActiveSessionsCard.tsx"), "utf8");
    expect(ui).toContain("suspended_at");
    expect(ui).toContain('"resume_tool"');
    expect(ui).toContain("Suspended by NazAI");
  });
});

describe("what is recorded", () => {
  const kindsInCode = (): string[] => {
    const m = /export type EvidenceKind =([^;]+);/.exec(read("_shared/security-evidence.ts"))!;
    return [...m[1].matchAll(/"([a-z_]+)"/g)].map((x) => x[1]).sort();
  };
  it("the kinds the code writes are exactly the kinds the database accepts", () => {
    const check = /CHECK \(kind IN \(([^)]+)\)\)/.exec(migration)!;
    const inDb = [...check[1].matchAll(/'([a-z_]+)'/g)].map((x) => x[1]).sort();
    expect(inDb).toEqual(kindsInCode());
    expect(kindsInCode()).toEqual(["access_refused", "connector_call", "connector_result", "containment", "content_held", "credential_change", "outbound_blocked", "output_stored", "rule_applied"]);
  });

  it("every kind is written somewhere and described in the document", () => {
    const all = ["_shared/provider-writes.ts", "_shared/outer-control-session.ts", "_shared/outer-control-containment.ts", "_shared/security-evidence.ts", "agent-runtime/index.ts"].map(read).join("\n");
    for (const k of kindsInCode().filter((k) => k !== "credential_change")) expect(all, k).toContain(k);
    for (const k of kindsInCode()) expect(doc("security-evidence.md"), k).toContain(k);
  });

  it("a result is recorded next to every provider write and every Outer Control tool call", () => {
    expect(read("_shared/provider-writes.ts")).toMatch(/dispatchProviderWrite\(kind[\s\S]{0,600}kind: "connector_result"/);
    expect(read("_shared/outer-control-session.ts")).toContain('kind: "connector_result"');
  });

  it("a refused request from a known account is recorded where it is refused", () => {
    expect(read("_shared/control-api-auth.ts")).toContain('noteAccessRefused(admin, row.user_id, row.key_id ?? null, "key_paused"');
    expect((read("control-api/index.ts").match(/noteAccessRefused\(/g) ?? []).length).toBe(1);
    expect((read("outer-control/index.ts").match(/noteAccessRefused\(/g) ?? []).length).toBe(2);
  });

  it("the migration keeps the evidence table as it was: constraint only widened, the new columns hidden from secrets, a read-only summary", () => {
    expect(migration).toContain("DROP CONSTRAINT IF EXISTS security_evidence_kind_check");
    expect(migration).not.toMatch(/DELETE FROM public\.security_evidence|UPDATE public\.security_evidence|TRUNCATE/);
    expect(migration).toContain("GRANT SELECT (suspended_at, suspended_reason) ON public.external_tools TO authenticated");
    expect(migration).toContain("my_security_activity");
    expect(migration).toMatch(/REVOKE ALL ON FUNCTION public\.my_security_activity\(integer\) FROM PUBLIC, anon/);
    expect(migration).toContain("WHERE e.user_id = auth.uid()");
  });
});
