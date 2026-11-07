// General data security, task 6: security evidence for critical actions (docs/security-evidence.md).
//
// These checks fail the build when a connected service can be called without its evidence row, when a kind of evidence stops being
// written, or when the migration's protections (append-only, server-only writes, signing with the vault key, the weekly check) go missing.
import { describe, it, expect } from "vitest";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

const ROOT = join(__dirname, "../..");
const FN = join(ROOT, "supabase/functions");
const read = (p: string) => readFileSync(join(FN, p), "utf8");
const sql = readFileSync(join(ROOT, "supabase/migrations/20261110010000_external_content_and_security_evidence.sql"), "utf8");

describe("no evidence, no connector call", () => {
  it("runProviderWrite records before it calls anything, and refuses when the row can not be written", () => {
    const src = read("_shared/provider-writes.ts");
    const fnStart = src.indexOf("export async function runProviderWrite(");
    const ev = src.indexOf('kind: "connector_call"', fnStart);
    expect(ev).toBeGreaterThan(fnStart);
    expect(ev).toBeLessThan(src.indexOf("switch (kind) {", fnStart));
    expect(src.slice(ev, ev + 600)).toMatch(/if \(!ev\.ok\) return fail\(NO_EVIDENCE_MESSAGE\);/);
  });

  it("only agent-runtime skips that row, and only because it wrote one itself for the same call", () => {
    const callers = readdirSync(FN).filter((d) => !d.startsWith("_") && !d.startsWith(".")).flatMap((d) => {
      try { return [{ d, src: read(`${d}/index.ts`) }]; } catch { return []; }
    }).filter(({ src }) => src.includes("runProviderWrite("));
    expect(callers.map((c) => c.d).sort()).toEqual(["agent-approval", "agent-runtime", "control-engine", "outer-control"]);
    for (const { d, src } of callers) {
      const skips = (src.match(/evidenceRecorded/g) ?? []).length;
      if (d === "agent-runtime") expect(src).toMatch(/runProviderWrite\(tool\.kind, supabase, userId, agentId, input, \{ evidenceRecorded \}\)/);
      else expect(skips, d).toBe(0);
    }
  });

  it("agent-runtime writes the row after every gate and before any action runs, and refuses without it", () => {
    const src = read("agent-runtime/index.ts");
    const ev = src.indexOf("// ---- SECURITY EVIDENCE (no evidence, no connector call)");
    expect(ev).toBeGreaterThan(src.indexOf("// ---- Known-issue gate"));
    expect(ev).toBeGreaterThan(src.indexOf("// ---- CONTROL ENGINE GATE"));
    for (const kind of ["send_email", "http_post", "create_doc", "edit_sheet", "reply_email", "schedule_followup", "upsert_client_note", "create_calendar_event"]) {
      expect(ev, kind).toBeLessThan(src.indexOf(`if (tool.kind === "${kind}"`));
    }
    expect(src.slice(ev, ev + 1500)).toMatch(/if \(!ev\.ok\) \{[\s\S]*?continue;/);
  });

  it("Outer Control writes the row before it calls a tool outside NazAI, and stops without it", () => {
    const src = read("_shared/outer-control-session.ts");
    const ev = src.indexOf('kind: "connector_call"');
    expect(ev).toBeGreaterThan(0);
    expect(ev).toBeLessThan(src.indexOf("res = await deps.fetchImpl(tool.endpoint_url"));
    expect(src.slice(ev, ev + 500)).toMatch(/if \(!ev\.ok\) \{ await finish\(admin, s, "failed", NO_EVIDENCE_MESSAGE, deps\);/);
  });
});

describe("each kind of evidence is written", () => {
  it("rule_applied, content_held and output_stored in Outer Control; content_held and outbound_blocked in agent-runtime", () => {
    const session = read("_shared/outer-control-session.ts");
    for (const k of ["rule_applied", "content_held", "output_stored"]) expect(session, k).toContain(`kind: "${k}"`);
    expect(session).toMatch(/noteOutboundBlock\(admin, s\.user_id, e,/);
    const rt = read("agent-runtime/index.ts");
    expect(rt).toContain('kind: "content_held"');
    expect(rt).toMatch(/noteOutboundBlock\(supabase, userId, payload\.summary/);
    expect(read("_shared/outer-control-relay.ts")).toContain('kind: "content_held"');
  });
  it("credential changes are written by database triggers on every table that holds a credential reference", () => {
    for (const t of ["external_tools", "agent_integrations", "agents", "api_keys", "webhooks"]) {
      expect(sql, t).toMatch(new RegExp(`CREATE TRIGGER ${t}_credential_evidence AFTER INSERT OR UPDATE OF [a-z_, ]+ OR DELETE ON public\\.${t}`));
    }
  });
});

describe("the evidence table can not be written around, changed or removed", () => {
  it("nobody writes the table directly; record_evidence() is the server's only way in", () => {
    expect(sql).toMatch(/REVOKE ALL ON public\.security_evidence FROM PUBLIC, anon, authenticated, service_role;/);
    expect(sql).toMatch(/GRANT SELECT ON public\.security_evidence TO authenticated, service_role;/);
    expect(sql).toMatch(/GRANT EXECUTE ON FUNCTION public\.record_evidence\([^)]*\) TO service_role;/);
    expect(sql).not.toMatch(/GRANT EXECUTE ON FUNCTION public\.record_evidence\([^)]*\) TO [^;]*authenticated/);
  });
  it("rows are append-only, chained per account and signed with the vault key", () => {
    expect(sql).toMatch(/CREATE TRIGGER security_evidence_append_only BEFORE UPDATE OR DELETE ON public\.security_evidence/);
    expect(sql).toMatch(/CREATE TRIGGER security_evidence_no_truncate BEFORE TRUNCATE ON public\.security_evidence/);
    expect(sql).toMatch(/extensions\.hmac\(h, k, 'sha256'\)/);
    expect(sql).toMatch(/WHERE name = 'security_evidence_key'/);
    expect(sql).toMatch(/pg_advisory_xact_lock/);
    expect(sql).toMatch(/CHECK \(public\.evidence_subject_ok\(subject\)\)/);
  });
  it("the chain is verified (hash, link, signature, gaps, a cut end) and checked every week", () => {
    for (const p of ["'gap'", "'broken_link'", "'hash_mismatch'", "'signature_mismatch'", "'missing_rows'"]) expect(sql, p).toContain(p);
    expect(sql).toMatch(/cron\.schedule\('security-evidence-weekly-check'/);
    expect(sql).toMatch(/kind = 'security_evidence' AND resolved_at IS NULL/);
  });
});
