// User & data isolation, front 3: two permanent guards over the server functions (supabase/functions).
//
// 1. Identity comes from the verified token. A function may read an account or user id from the request (body or address) only if it
//    verifies it (resolveAccountScope / resolveCallerAccount / resolveCallerReadAccount / readScope / an is_account_member check) or
//    it is a scheduled job that only the server key can start.
// 2. Ids are checked before they are acted on. A function that holds the full-access key bypasses row level security, so a query on an
//    owner-scoped table without an owner filter is only safe when the id came from a row the function already loaded under an owner
//    check. Every such query was reviewed once (REVIEWED below, with why); a function gaining one more fails here until it is reviewed
//    too (use assertOwned from _shared/caller.ts, or filter by the account in the query).
import { describe, it, expect } from "vitest";
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { FUNCTION_ACCESS } from "../../supabase/functions/_shared/function-access";

const ROOT = join(__dirname, "../../supabase/functions");
const MIGRATIONS = join(__dirname, "../../supabase/migrations");

// --- 1. identity from the request -------------------------------------------------------------------------------------------------
const IDENT = "(?:user_?[Ii]d|account_?[Ii]d|owner_?[Ii]d|account_owner_id|accountOwnerId)";
const FROM_REQUEST: RegExp[] = [
  new RegExp(`\\b(?:body|payload|input|params|data|reqBody|requestBody|args)\\??\\.\\s*${IDENT}\\b`),
  new RegExp(`searchParams\\.get\\(\\s*["']${IDENT}["']`),
  new RegExp(`\\["${IDENT}"\\]`),
];
const VERIFIES = /resolveAccountScope\(|resolveCallerAccount\(|resolveCallerReadAccount\(|readScope\(|is_account_member/;

export function readsIdentityFromRequest(src: string): string[] {
  return src.split("\n").filter((l) => !/^\s*(\/\/|\*)/.test(l) && FROM_REQUEST.some((rx) => rx.test(l))).map((l) => l.trim());
}

const functions = readdirSync(ROOT).filter((d) => !d.startsWith("_") && existsSync(join(ROOT, d, "index.ts")));
const source = (fn: string) => readFileSync(join(ROOT, fn, "index.ts"), "utf8");

describe("an account or user id sent with the request is only used after it is verified", () => {
  it("the check finds what it looks for (the guard itself works)", () => {
    expect(readsIdentityFromRequest('const a = body?.account_id;')).toHaveLength(1);
    expect(readsIdentityFromRequest('const u = url.searchParams.get("user_id");')).toHaveLength(1);
    expect(readsIdentityFromRequest('// body.user_id is never trusted')).toHaveLength(0);
    expect(readsIdentityFromRequest('const id = body.agent_id;')).toHaveLength(0);
    expect(VERIFIES.test('await resolveAccountScope(userClient, userId, body?.account_id)')).toBe(true);
    expect(VERIFIES.test('const accountId = body.account_id;')).toBe(false);
  });

  it.each(functions)("%s", (fn) => {
    const hits = readsIdentityFromRequest(source(fn));
    if (!hits.length) return;
    const access = FUNCTION_ACCESS[fn]?.access;
    // A scheduled job is started only with the server key, so the account it is scoped to comes from a trusted caller.
    const ok = access === "system" || VERIFIES.test(source(fn));
    expect(ok, `${fn} reads an identity from the request (${hits[0]}) without verifying it`).toBe(true);
  });
});

// --- 1b. who is calling comes from requireCaller ----------------------------------------------------------------------------------
// Every function a signed-in user calls identifies them through requireCaller (_shared/caller.ts): the user id comes from the verified
// token and nothing else. These keep their own check, each for a recorded reason; a new function is not added here without one.
const OWN_CHECK: Record<string, string> = {
  "agent-approval": "verifies the raw token with auth.getClaims, then rate limits and acts as that user",
  "agent-runtime": "also runs scheduled agents for agent-scheduler (server key plus the agent's owner, read from the agent row)",
  "analyze-inputs": "sign-in is optional: a signed-in caller gets their integration snapshot, anyone else gets none; the user's own client is used",
  "compile-agent-manifest": "sign-in is optional (try-before-signup flow); the user's own client is used, saved data needs a user",
  "compile-website-manifest": "sign-in is optional (try-before-signup flow); the user's own client is used, saved data needs a user",
  "control-engine": "accepts a user token (auth.getUser) or the server key with a named user, sent by agent-runtime and control-api",
  "control-test-suite": "passes the caller's token on to control-engine for every scenario (checkedBy in function-access.ts)",
  "delete-project": "verifies the raw token with auth.getClaims on purpose (see its header), then deletes with an explicit owner filter",
  "mcp": "generated MCP bundle: every tool runs with the caller's own token",
};
const userFunctions = Object.entries(FUNCTION_ACCESS).filter(([, a]) => a.access === "user").map(([fn]) => fn);

describe("a function a signed-in user calls identifies them through requireCaller", () => {
  it.each(userFunctions)("%s", (fn) => {
    const src = readFileSync(join(ROOT, fn, "index.ts"), "utf8");
    const uses = /requireCaller\(/.test(src) && /_shared\/caller\.ts/.test(src);
    if (OWN_CHECK[fn]) {
      // an exception must stay true: it is removed once the function adopts requireCaller
      expect(uses, `${fn} uses requireCaller now: drop it from OWN_CHECK`).toBe(false);
    } else {
      expect(uses, `${fn} must identify the caller with requireCaller (_shared/caller.ts), or be listed in OWN_CHECK with the reason`).toBe(true);
    }
  });

  it("every exception names a function that exists", () => {
    for (const fn of Object.keys(OWN_CHECK)) expect(userFunctions, fn).toContain(fn);
  });
});

// --- 2. queries by id with the full-access key ----------------------------------------------------------------------------------------
const register = readFileSync(join(MIGRATIONS, "20261104020000_isolation_register.sql"), "utf8");
const ownerColumn = new Map<string, string>(
  [...register.matchAll(/\('(\w+)', '(?:owner|team|public_by_link|self|membership)', '(\w+)'/g)].map((m) => [m[1], m[2]] as [string, string]),
);

function adminNames(src: string): Set<string> {
  const names = new Set<string>();
  for (const m of src.matchAll(/(?:const|let)\s+(\w+)\s*=\s*(?:createClient|createPlainClient)\(\s*[^;]*?(?:SERVICE_ROLE|serviceKey|SERVICE_KEY)[^;]*?\)/gs)) names.add(m[1]);
  if (/SERVICE_ROLE|serviceKey/.test(src)) for (const n of ["admin", "adminClient", "serviceClient", "supabaseAdmin"]) names.add(n);
  return names;
}

/** Queries with the full-access key on an owner-scoped table whose statement has no owner filter at all. */
export function unscopedAdminQueries(src: string): string[] {
  const admin = adminNames(src);
  const found: string[] = [];
  for (const m of src.matchAll(/\b(\w+)\s*\.from\(\s*"(\w+)"\s*\)/g)) {
    const [, client, table] = m;
    const col = ownerColumn.get(table);
    if (!col || !admin.has(client)) continue;
    const end = src.indexOf(";", m.index! + m[0].length);
    const stmt = src.slice(m.index!, end === -1 ? m.index! + 600 : end).slice(0, 1500);
    if (new RegExp(`["'](?:${col}|user_id|account_owner_id|owner_id)["']`).test(stmt) || /\b(userId|accountId|targetUserId|ownerId|user_id|account_id)\b/.test(stmt)) continue;
    found.push(`${table}: ${stmt.replace(/\s+/g, " ").slice(0, 90)}`);
  }
  return found;
}

/**
 * Reviewed, with why. Each group is safe because the id the query uses was never taken straight from the request:
 *  - sweeps and other system jobs (server key required): they work across all accounts on purpose.
 *  - api-keys: every route first loads the key with `.eq("user_id", <verified account>)` and answers 404 otherwise; the queries
 *    below it filter by that key.
 *  - control-api: the account and key come from the API key itself (auth.keyId / userId); decision and approval lookups add the account.
 *    /status counts recent decisions platform-wide on purpose and returns only a status word.
 *  - control-engine, agent-approval, control-incidents, generate-site-images, outer-control-drive, outer-control: the row is loaded
 *    by id, its owner compared with the caller (answering "not found" otherwise), and only then updated.
 *  - encrypted-write: the comment is written after record_approval_signoff, which raises "not authorized" for anyone who may not sign off.
 *  - _shared modules: take ids of rows the calling function already loaded under an owner check, or that the server created.
 */
const REVIEWED: Record<string, number> = {
  "_shared": 46,
  "account-invite-accept": 3,
  "agent-approval": 2,
  "agent-runtime": 1,
  "agent-scheduler": 6,
  "analyze-org-insights": 1,
  "api-keys": 19,
  "approval-escalation-sweep": 2,
  "audit-integrity-sweep": 5,
  "calibrate-confidence": 1,
  "canva-oauth-callback": 2,
  "content-gap-backlog-sweep": 2,
  "content-gap-triage-sweep": 4,
  "control-api": 15,
  "control-api-abuse-sweep": 5,
  "control-engine": 11,
  "control-incidents": 1,
  "data-deletion-sweep": 1,
  "decision-embedding-backfill-sweep": 2,
  "encrypted-write": 1,
  "generate-site-images": 10,
  "incident-escalation-sweep": 1,
  "integration-revocation-sweep": 1,
  "integration-sync": 1,
  "measure-decision-outcomes": 2,
  "notion-oauth-callback": 2,
  "outcome-quality-sweep": 2,
  "outer-control": 1,
  "outer-control-drive": 7,
  "outer-control-session-sweep": 4,
  "precedent-pipeline-health-sweep": 6,
  "recurring-assembly-sweep": 1,
  "retention-sweep": 2,
  "shopify-oauth-callback": 2,
  "site-images-backfill-sweep": 4,
  "site-images-cleanup-sweep": 1,
  "slack-oauth-callback": 2,
  "stuck-approval-sweep": 2,
  "webhook-retry-sweep": 3,
};

function countsByFunction(): Record<string, string[]> {
  const out: Record<string, string[]> = {};
  const add = (name: string, file: string) => {
    const q = unscopedAdminQueries(readFileSync(file, "utf8"));
    if (q.length) out[name] = [...(out[name] ?? []), ...q];
  };
  for (const d of readdirSync(ROOT)) {
    const dir = join(ROOT, d);
    if (!statSync(dir).isDirectory()) continue;
    for (const f of readdirSync(dir)) {
      if (!f.endsWith(".ts") || f.endsWith("_test.ts")) continue;
      add(d.startsWith("_") ? "_shared" : d, join(dir, f));
    }
  }
  return out;
}

describe("a query by id with the full-access key does not appear without a review", () => {
  it("the check finds what it looks for (the guard itself works)", () => {
    const admin = 'const admin = createClient(url, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);\n';
    expect(unscopedAdminQueries(admin + 'await admin.from("agents").select("*").eq("id", body.agent_id);')).toHaveLength(1);
    expect(unscopedAdminQueries(admin + 'await admin.from("agents").select("*").eq("id", body.agent_id).eq("user_id", accountId);')).toHaveLength(0);
    expect(unscopedAdminQueries('const db = createClient(url, anon);\nawait db.from("agents").select("*").eq("id", x);')).toHaveLength(0);
    expect(unscopedAdminQueries(admin + 'await admin.from("not_a_register_table").select("*").eq("id", x);')).toHaveLength(0);
  });

  it("no function has more than the reviewed number", () => {
    const now = countsByFunction();
    if (process.env.PRINT_UNSCOPED) console.log(JSON.stringify(Object.fromEntries(Object.entries(now).map(([k, v]) => [k, v.length])), null, 1));
    const over = Object.entries(now).filter(([fn, q]) => q.length > (REVIEWED[fn] ?? 0)).map(([fn, q]) => `${fn}: ${q.length} (reviewed ${REVIEWED[fn] ?? 0}), e.g. ${q[q.length - 1]}`);
    expect(over).toEqual([]);
  });
});
