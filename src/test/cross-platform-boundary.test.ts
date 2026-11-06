// General data security, task 4: cross-platform boundary control (docs/cross-platform-boundary.md).
//
// These checks fail the build when Outer Control code loads a connected tool without saying whose it is, when a run on one of the
// account's agents stops carrying its signed token (or agent-runtime stops checking it), or when the migration's database checks
// (references inside one account, one owner per vault secret) go missing. boundary_report() checks the live database.
import { describe, it, expect } from "vitest";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

const ROOT = join(__dirname, "../..");
const FUNCTIONS = join(ROOT, "supabase/functions");
const read = (p: string) => readFileSync(p, "utf8");

/** The Outer Control code: the shared outer-control modules, projects, and the outer-control functions. */
const files = [
  ...readdirSync(join(FUNCTIONS, "_shared")).filter((f) => (/^outer-control.*\.ts$/.test(f) || f === "projects.ts") && !f.endsWith("_test.ts")).map((f) => `_shared/${f}`),
  ...readdirSync(FUNCTIONS).filter((d) => d.startsWith("outer-control") && existsSync(join(FUNCTIONS, d, "index.ts"))).map((d) => `${d}/index.ts`),
];

/** Every query on external_tools that names no account: the chain from .from("external_tools") to the end of the statement. */
export function unscopedToolQueries(src: string): string[] {
  const out: string[] = [];
  for (const m of src.matchAll(/\.from\("external_tools"\)/g)) {
    const end = src.indexOf(";", m.index!);
    const chain = src.slice(m.index!, end < 0 ? m.index! + 600 : end);
    if (/\.insert\(/.test(chain) && /user_id/.test(chain)) continue; // a new row is written for its account
    if (/\.eq\(\s*"user_id"/.test(chain)) continue;
    out.push(chain.replace(/\s+/g, " ").slice(0, 160));
  }
  return out;
}

// Reviewed once each, with why; a file gaining one more fails here until it is reviewed too (or filters by the account).
const REVIEWED: Record<string, { count: number; why: string }> = {
  "_shared/outer-control-keepalive.ts": { count: 2, why: "the keepalive sweep tests every account's tools, each with its own key only; the result is written by that tool's id" },
  "_shared/outer-control-tools.ts": { count: 1, why: "whether another tool shares this key: a vault secret has one owning account (vault_secret_owners), so only that account's tools can" },
  "outer-control-drive/index.ts": { count: 2, why: "the test result of a tool just loaded for this account, written by its id" },
};

describe("Outer Control loads a tool only for the account that owns it", () => {
  it("finds an unscoped query (the guard itself works)", () => {
    expect(unscopedToolQueries('const { data } = await admin.from("external_tools").select("*").eq("id", s.tool_id).maybeSingle();')).toHaveLength(1);
    expect(unscopedToolQueries('await admin.from("external_tools").select("*").eq("id", id).eq("user_id", s.user_id).maybeSingle();')).toEqual([]);
    expect(unscopedToolQueries('await admin.from("external_tools").insert({ user_id: accountId, name });')).toEqual([]);
  });

  it("covers the Outer Control code", () => {
    expect(files).toEqual(expect.arrayContaining(["_shared/outer-control-session.ts", "_shared/outer-control-workflow.ts", "_shared/outer-control-report.ts", "outer-control-drive/index.ts"]));
  });

  it.each(files)("%s", (f) => {
    expect(unscopedToolQueries(read(join(FUNCTIONS, f))).length, `${f}: ${unscopedToolQueries(read(join(FUNCTIONS, f))).join(" | ")}`).toBe(REVIEWED[f]?.count ?? 0);
  });

  it("the session engine resolves its tool through resolveSessionTool (account and not removed)", () => {
    const src = read(join(FUNCTIONS, "_shared/outer-control-session.ts"));
    expect(src.match(/resolveSessionTool<ToolRow>\(admin, s\)/g)?.length).toBe(3);
    const boundary = read(join(FUNCTIONS, "_shared/outer-control-boundary.ts"));
    expect(boundary).toMatch(/\.eq\("id", toolId\)\.eq\("user_id", session\.user_id\)\.is\("removed_at", null\)/);
  });
});

describe("a run on one of the account's agents is bound to its account, Task, step and agent", () => {
  it("the session engine sends the signed token with every agent run", () => {
    const src = read(join(FUNCTIONS, "_shared/outer-control-session.ts"));
    expect(src).toMatch(/\[RUN_TOKEN_HEADER\]: \(await deps\.runToken\?\.\(\{ account: s\.user_id, task: s\.workflow_id \?\? null, session: s\.id, agent: tool\.agent_id \}\)\)/);
  });
  it("agent-runtime refuses an Outer Control run without a matching token, before the agent runs", () => {
    const src = read(join(FUNCTIONS, "agent-runtime/index.ts"));
    const check = src.indexOf("verifyRunToken(keys, req.headers.get(RUN_TOKEN_HEADER), { account: userId, task: bodyOuterTaskId || null, session: bodyOuterSessionId, agent: agentId })");
    expect(check).toBeGreaterThan(0);
    expect(src.slice(check, check + 600)).toMatch(/return json\(\{ error: "run_not_bound"/);
    expect(check).toBeLessThan(src.indexOf('.from("agents").select("*").eq("id", agentId).eq("user_id", userId)'));
  });
  it("the token is signed with its own key, never the content fingerprint key", () => {
    const crypto = read(join(FUNCTIONS, "_shared/field-crypto.ts"));
    expect(crypto).toMatch(/token: await derive\("nazai signed token v1"/);
    const boundary = read(join(FUNCTIONS, "_shared/outer-control-boundary.ts"));
    expect(boundary).toMatch(/crypto\.subtle\.sign\("HMAC", key,/);
    expect(boundary).not.toMatch(/\.mac\b/);
  });
});

describe("the database keeps references and credentials inside one account", () => {
  const sql = read(join(ROOT, "supabase/migrations/20261109020000_cross_platform_boundary.sql"));
  it("every Task, step, tool and project reference is registered for the same-account trigger", () => {
    for (const ref of ["('outer_control_sessions', 'tool_id', 'external_tools'", "('outer_control_sessions', 'fallback_tool_id', 'external_tools'",
      "('outer_control_sessions', 'workflow_id', 'outer_control_workflows'", "('outer_control_workflows', 'project_id', 'imported_projects'",
      "('external_tools', 'agent_id', 'agents'", "('outer_control_session_steps', 'session_id', 'outer_control_sessions'"]) expect(sql).toContain(ref);
    expect(sql).toMatch(/CREATE TRIGGER %I BEFORE INSERT OR UPDATE OF %s, user_id ON public\.%I FOR EACH ROW EXECUTE FUNCTION public\.enforce_same_account/);
  });
  it("every column that holds a vault secret id claims its owner", () => {
    for (const t of ["external_tools_vault_owner", "agent_integrations_vault_owner", "agents_vault_owner", "api_keys_vault_owner", "webhooks_vault_owner"]) expect(sql).toContain(`CREATE TRIGGER ${t}`);
    expect(sql).toMatch(/claim_vault_secret\('secret_id', 'previous_secret_id'\)/);
  });
  it("a weekly check reports any crossing", () => {
    expect(sql).toMatch(/cron\.schedule\('boundary-weekly-check'/);
    expect(sql).toMatch(/'crosses_accounts'/);
    expect(sql).toMatch(/'secret_shared'/);
  });
});
