// Safe input & output handling, front 5: values placed into database queries.
//
// The query builder escapes values passed to .eq / .in / .match. It can NOT escape a value that is pasted into a filter STRING:
// .or(`agent_id.eq.${x}`), .filter(...), .not(...), .textSearch(...), or a like pattern. A request value like "x,user_id.neq.0" there
// adds its own conditions. The same goes for a column list or sort order taken from the request (.select(x), .order(x)).
// This guard lists every place such a string is built from something that is not a literal, and each must be on the list below with
// what the value is (a timestamp the server made, a constant, an id read back from the database, an id already checked to be an id).
// A new one fails until it is reviewed.
import { describe, it, expect } from "vitest";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";

const ROOT = join(__dirname, "../..");
function files(dir: string): string[] {
  return readdirSync(join(ROOT, dir)).flatMap((n) => {
    const p = `${dir}/${n}`;
    if (statSync(join(ROOT, p)).isDirectory()) return ["test", "node_modules", "_test-support"].includes(n) ? [] : files(p);
    return /\.(tsx?)$/.test(n) && !/(_test|\.test)\./.test(n) ? [p] : [];
  });
}
const SOURCES = [...files("supabase/functions"), ...files("src")];

/** The argument text of every call to one of `methods`, with template-literal interpolations extracted. */
export function dynamicQueryParts(raw: string): { method: string; part: string }[] {
  const out: { method: string; part: string }[] = [];
  // comments are not code (a URL's "//" inside a string is kept: only "//" at a line start or after whitespace starts a comment)
  const src = raw.replace(/\/\*[\s\S]*?\*\//g, " ").replace(/(^|\s)\/\/.*$/gm, "$1");
  const re = /\.(or|filter|not|textSearch|like|ilike|order|select)\(\s*/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(src))) {
    const method = m[1];
    let i = m.index + m[0].length;
    const c = src[i];
    if (c === "`") {
      // a template literal: collect each ${...} (brace depth aware)
      i++;
      while (i < src.length && src[i] !== "`") {
        if (src[i] === "\\") { i += 2; continue; }
        if (src[i] === "$" && src[i + 1] === "{") {
          let depth = 1, j = i + 2;
          while (j < src.length && depth) { if (src[j] === "{") depth++; else if (src[j] === "}") depth--; j++; }
          out.push({ method, part: src.slice(i + 2, j - 1).trim() });
          i = j; continue;
        }
        i++;
      }
    } else if (c === '"' || c === "'" || c === ")" || c === "{" || c === "[") {
      continue; // a plain literal, no argument, or an options object
    } else if (method === "order" || method === "select" || method === "or" || method === "textSearch") {
      // a bare expression as the column list or sort column (arrays have no .order/.select, so this is always the query builder);
      // .filter / .not with a bare argument are ordinary list methods, and only their template-literal form is a query string
      const arg = src.slice(i, i + 120).split(/[,)\n]/)[0].trim();
      if (arg) out.push({ method, part: arg });
    }
  }
  return out;
}

// file -> the exact expressions allowed there, and what they are
const REVIEWED: Record<string, Record<string, string>> = {
  "supabase/functions/_shared/outer-control-boundary.ts": { cols: "a constant column list the calling code passes (resolveSessionTool, accountTools), never a request value" },
  "supabase/functions/outer-control-session-sweep/index.ts": { "new Date(now).toISOString()": "a timestamp the server made" },
  "supabase/functions/control-api/index.ts": { periodStartIso: "a timestamp the server made from a clamped number of days", DECISION_EXPORT_FIELDS: "a constant column list", "exportCursorFilter(cursor": "a cursor decodeExportCursor accepted only as a timestamp and a plain id (no filter characters)" },
  "supabase/functions/control-api-abuse-sweep/index.ts": { "new Date().toISOString()": "a timestamp the server made" },
  "supabase/functions/_shared/outer-control-keepalive.ts": { cutoff: "a timestamp the server made" },
  "supabase/functions/_shared/outer-control-session.ts": { "iso(began)": "a timestamp the server made" },
  "supabase/functions/_shared/outer-control-tools.ts": { "tool.id": "the id read back from the database row (not the request text)" },
  "supabase/functions/capability-status/index.ts": { agentId: "checked to be an id (UUID_RE) just above; anything else is refused with 400" },
  "supabase/functions/agent-runtime/index.ts": { "agent.id ? `agent_id.eq.${agent.id}": "the id of the agent row the run loaded" },
  "supabase/functions/_shared/field-crypto.ts": { column: "a column name from the encrypted-columns register (code constants)", ec: "that column's _enc twin" },
  "src/components/control/outer/WorkflowsCard.tsx": { WF_COLS: "a constant column list", 'withGoal ? `, ${GOAL_COLS}` : ""': "constant column lists", 'withArchive ? ", archived_at" : ""': "a constant column name" },
  "supabase/functions/_shared/projects.ts": { PROJECT_COLS: "a constant column list", stale: "built from the server's own key id (kid), never from a request" },
  "supabase/functions/_shared/outer-control-workflow.ts": { GOAL_COLUMNS: "a constant column list" },
  "supabase/functions/_shared/outer-control-starter.ts": { STARTER_TOOL_URL: "a constant address prefix" },
  "supabase/functions/_shared/caller.ts": { 'opts.select ?? "*"': "a column list passed by the calling server code, never by a request" },
  "src/components/agents/AgentCockpit.tsx": { EVENT_COLS: "a constant column list" },
  "src/components/agents/RunOutcomes.tsx": { ARTIFACT_COLS: "a constant column list" },
  "src/components/control/outer/ActiveSessionsCard.tsx": { "withArchive ? `${SESSION_COLS}": "constant column lists", "withArchive ? `${cols}": "constant column lists" },
  "src/components/control/outer/TaskTracker.tsx": { "withProject ? `${COLS}": "constant column lists" },
  "src/hooks/useProjectList.ts": { PROJECT_COLS: "a constant column list" },
  "src/hooks/usePendingApprovalsFeed.ts": { RUNNABLE: "a constant list of action types" },
  "src/pages/ControlPendingDecisions.tsx": { CONFIDENCE_BAR: "a constant number" },
  "src/pages/ControlLiveFeed.tsx": { OUTER_EVAL_COLS: "a constant column list" },
  "src/pages/ProjectView.tsx": { PROJECT_COLS: "a constant column list" },
};

describe("no request value is pasted into a query string", () => {
  it("the scan finds what it looks for (the guard itself works)", () => {
    expect(dynamicQueryParts("q.or(`agent_id.eq.${agentId},agent_id.is.null`)")).toEqual([{ method: "or", part: "agentId" }]);
    expect(dynamicQueryParts("q.or(`a.lt.${new Date(x).toISOString()}`)")).toEqual([{ method: "or", part: "new Date(x).toISOString()" }]);
    expect(dynamicQueryParts("q.ilike('name', `%${body.q}%`)")).toEqual([]); // second argument: covered below
    expect(dynamicQueryParts("q.order(body.sort)")).toEqual([{ method: "order", part: "body.sort" }]);
    expect(dynamicQueryParts('q.select("id, name").eq("id", x)')).toEqual([]);
    expect(dynamicQueryParts("q.select()")).toEqual([]);
  });

  it.each(SOURCES)("%s", (f) => {
    const parts = dynamicQueryParts(readFileSync(join(ROOT, f), "utf8"));
    for (const { method, part } of parts) {
      expect(REVIEWED[f]?.[part], `${f}: .${method}() is built from "${part}". If it can come from a request, validate it (an id with UUID_RE, a choice from a fixed list) or pass it through .eq/.in; then record it in REVIEWED with what it is.`).toBeTruthy();
    }
  });

  it("a like pattern is never built from a request value", () => {
    for (const f of SOURCES) {
      const src = readFileSync(join(ROOT, f), "utf8");
      for (const m of src.matchAll(/\.(i?like)\(\s*["'][^"']+["']\s*,\s*`([^`]*)`/g)) {
        for (const e of m[2].matchAll(/\$\{([^}]+)\}/g)) {
          expect(REVIEWED[f]?.[e[1].trim()], `${f}: .${m[1]}() pattern built from "${e[1]}": escape % and _ or use .eq`).toBeTruthy();
        }
      }
    }
  });

  it("every reviewed entry still exists (no stale exceptions)", () => {
    for (const [f, entries] of Object.entries(REVIEWED)) {
      const found = new Set([
        ...dynamicQueryParts(readFileSync(join(ROOT, f), "utf8")).map((p) => p.part),
        ...[...readFileSync(join(ROOT, f), "utf8").matchAll(/\.(?:i?like)\(\s*["'][^"']+["']\s*,\s*`([^`]*)`/g)].flatMap((m) => [...m[1].matchAll(/\$\{([^}]+)\}/g)].map((e) => e[1].trim())),
      ]);
      for (const part of Object.keys(entries)) expect(found.has(part), `${f}: "${part}" is no longer used; remove it from REVIEWED`).toBe(true);
    }
  });
});

describe("dynamic SQL inside database functions quotes what it builds", () => {
  it("every EXECUTE in a migration uses format() with %I / %L for names and values, or passes values with USING", () => {
    const dir = "supabase/migrations";
    const bad: string[] = [];
    for (const f of readdirSync(join(ROOT, dir)).filter((n) => n.endsWith(".sql"))) {
      const sql = readFileSync(join(ROOT, dir, f), "utf8");
      for (const m of sql.matchAll(/EXECUTE\s+([^;]{0,400})/gi)) {
        const stmt = m[1];
        if (/^format\s*\(/i.test(stmt) || /^'[^']*'\s*(USING|INTO|$)/i.test(stmt) || /^_?sql\b|^stmt\b|^q\b/i.test(stmt)) continue;
        if (/\|\|\s*(_|p_|v_)?\w*(name|text|input|value|arg)/i.test(stmt)) bad.push(`${f}: EXECUTE ${stmt.slice(0, 80)}`);
      }
    }
    expect(bad).toEqual([]);
  });
});
