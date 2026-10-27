// Run with: deno test supabase/functions/_shared/outer-control-tools_test.ts
import { removeTool } from "./outer-control-tools.ts";

function assertEquals<T>(a: T, b: T, m?: string) { if (JSON.stringify(a) !== JSON.stringify(b)) throw new Error(m ?? `expected ${JSON.stringify(b)}, got ${JSON.stringify(a)}`); }

const TOOL = "11111111-1111-4111-8111-111111111111";
type Row = Record<string, unknown>;

/** A tiny in-memory stand-in: just enough of the query chain removeTool uses. */
function fakeAdmin(tables: Record<string, Row[]>) {
  const rpcs: string[] = [];
  const admin = {
    from(table: string) {
      const rows = tables[table] ?? [];
      let op: "select" | "update" = "select";
      let patch: Row = {};
      const filters: ((r: Row) => boolean)[] = [];
      const q = {
        select() { op = "select"; return q; },
        update(p: Row) { op = "update"; patch = p; return q; },
        eq(k: string, v: unknown) { filters.push((r) => r[k] === v); return q; },
        in(k: string, vs: unknown[]) { filters.push((r) => vs.includes(r[k])); return q; },
        // The one filter string removeTool builds: tool_id.eq.<id>,fallback_tool_id.eq.<id>
        or(expr: string) {
          const parts = expr.split(",").map((p) => p.split(".eq."));
          filters.push((r) => parts.some(([k, v]) => r[k] === v));
          return q;
        },
        maybeSingle() { return Promise.resolve({ data: (() => { const r = rows.filter((x) => filters.every((f) => f(x)))[0]; return r ? { ...r } : null; })(), error: null }); },
        // deno-lint-ignore no-explicit-any
        then(res: any) {
          const hit = rows.filter((r) => filters.every((f) => f(r)));
          if (op === "update") hit.forEach((r) => Object.assign(r, patch));
          return Promise.resolve({ data: op === "select" ? hit : null, error: null }).then(res);
        },
      };
      return q;
    },
    rpc(name: string) { rpcs.push(name); return Promise.resolve({ data: null, error: null }); },
  };
  return { admin, rpcs };
}

Deno.test("removeTool: cancels sessions that use the tool, and only drops it as fallback from the others", async () => {
  const tables: Record<string, Row[]> = {
    external_tools: [{ id: TOOL, user_id: "u", credentials_secret_id: "sec-1", removed_at: null, enabled: true }],
    outer_control_sessions: [
      { id: "main", user_id: "u", tool_id: TOOL, fallback_tool_id: null, status: "running", workflow_id: "wf-1" },
      { id: "fallback-only", user_id: "u", tool_id: "other", fallback_tool_id: TOOL, status: "queued", workflow_id: "wf-2" },
      { id: "unrelated", user_id: "u", tool_id: "other", fallback_tool_id: "x", status: "running", workflow_id: null },
      { id: "done", user_id: "u", tool_id: TOOL, fallback_tool_id: null, status: "completed", workflow_id: null },
    ],
  };
  const { admin, rpcs } = fakeAdmin(tables);
  const r = await removeTool(admin, "u", TOOL);
  const by = (id: string) => tables.outer_control_sessions.find((s) => s.id === id)!;
  assertEquals(r.ok, true);
  assertEquals((r as { workflowIds?: string[] }).workflowIds, ["wf-1"], "only the cancelled session's workflow is moved on");
  assertEquals(by("main").status, "cancelled");
  assertEquals(by("fallback-only").status, "queued", "its own tool still works, so it is not cancelled");
  assertEquals(by("fallback-only").fallback_tool_id, null, "but it can no longer switch to the removed tool");
  assertEquals(by("fallback-only").tool_id, "other");
  assertEquals(by("unrelated").fallback_tool_id, "x");
  assertEquals(by("done").status, "completed");
  assertEquals(tables.external_tools[0].enabled, false);
  assertEquals(tables.external_tools[0].credentials_secret_id, null);
  assertEquals(rpcs.includes("delete_integration_secret"), false, "the database deletes the secret once nothing uses it (a shared key stays)");
});

Deno.test("removeTool: refuses an id that is not a plain uuid, and a tool already removed", async () => {
  const { admin } = fakeAdmin({ external_tools: [{ id: TOOL, user_id: "u", removed_at: "2026-01-01" }], outer_control_sessions: [] });
  assertEquals((await removeTool(admin, "u", "x,tool_id.neq.1") as { status: number }).status, 404);
  assertEquals((await removeTool(admin, "u", TOOL) as { status: number }).status, 404);
});
