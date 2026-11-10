// General data security, task 6: security evidence for critical actions (docs/security-evidence.md).
//
// One row per critical action, written by the database function record_evidence(): ids and SHA-256 hashes only, never content.
// The database links each row to the one before it (per account) and signs it with a key kept in the vault, so neither this code nor
// anyone with table access can write, change or remove a row unnoticed (verify_evidence_chain()).
//
// The nine kinds:
//   connector_call     a connected service is about to be called (an Outer Control tool, a provider write, an agent's action).
//                      Required: when the row can not be written, the call is not made.
//   credential_change  a stored credential was added, replaced, revoked or removed (written by database triggers, from any path).
//   rule_applied       a tool's reply was checked against the rules: which rules matched, the hash of the rule set, the verdict.
//   output_stored      a controlled result was stored as a Task's or step's final output (the hash of what was stored).
//   content_held       outside content was held by the unsafe-content gate (external-content.ts).
//   connector_result   what came back from a connected service: the outcome (ok, status, timeout) and the hash of the reply, never the
//                      reply. Written next to every connector_call (an Outer Control step, a provider write), so "what was sent"
//                      and "what happened" can be read side by side.
//   containment        a path was stopped or brought back: a tool suspended after unsafe signals, or resumed by its owner
//                      (outer-control-containment.ts).
//   access_refused     a request was refused at the door and the caller is known to belong to an account: a paused API key, or a key
//                      without the scope the route needs. (A key that does not exist belongs to no account, so there is no chain to
//                      write to; those are counted by the pre-auth rate limit and the function logs.)
//   outbound_blocked   the outbound guard refused a request (outbound-guard.ts): a credential to a host it does not belong to, or a
//                      destination outside the egress allowlist (egress.ts).
//
// Subject strings are capped and any web address in them keeps only its host and path (query values masked).
import { maskUrlQueries } from "./redact-secrets.ts";

// deno-lint-ignore no-explicit-any
type AnyAdmin = any;

export type EvidenceKind = "connector_call" | "credential_change" | "rule_applied" | "output_stored" | "content_held" | "outbound_blocked" | "connector_result" | "containment" | "access_refused";
export type EvidenceActor = "user" | "api_key" | "agent" | "system";

export type Evidence = {
  userId: string;
  kind: EvidenceKind;
  actor: EvidenceActor;
  actorId?: string | null;
  /** What the action touched, by id. Values are clipped to short scalars: a subject never carries content. */
  subject?: Record<string, string | number | boolean | null | undefined>;
  inputSha256?: string | null;
  outputSha256?: string | null;
  ruleIds?: string[];
  rulesSha256?: string | null;
  /** One lower-case word: allowed, block, modify, escalate, held, stored, refused ... */
  verdict: string;
};

const enc = new TextEncoder();
const hex = (b: ArrayBuffer) => [...new Uint8Array(b)].map((x) => x.toString(16).padStart(2, "0")).join("");

export async function sha256Text(text: string): Promise<string> {
  return hex(await crypto.subtle.digest("SHA-256", enc.encode(text)));
}

/** The hash of a value as it is sent (JSON for objects, the text itself for strings). */
export async function sha256Of(value: unknown): Promise<string> {
  return sha256Text(typeof value === "string" ? value : JSON.stringify(value ?? null));
}

/** One hash for a rule set: which rules, in which version, were in force (ids and update times, sorted). */
export async function rulesDigest(rules: { id: string; updated_at?: string | null; enabled?: boolean | null; shadow_mode?: boolean | null }[]): Promise<string> {
  const lines = rules.filter((r) => r.enabled !== false && !r.shadow_mode).map((r) => `${r.id}@${r.updated_at ?? ""}`).sort();
  return sha256Text(lines.join("\n"));
}

const ID = /^[A-Za-z0-9_:.-]{1,80}$/;

/** A subject with only short scalar values (what the database accepts): longer strings are clipped, objects are dropped. */
export function cleanSubject(s: Evidence["subject"]): Record<string, string | number | boolean | null> {
  const out: Record<string, string | number | boolean | null> = {};
  for (const [k, v] of Object.entries(s ?? {}).slice(0, 12)) {
    const key = k.slice(0, 40);
    if (v === undefined) continue;
    if (v === null || typeof v === "number" || typeof v === "boolean") out[key] = v;
    else if (typeof v === "string") out[key] = maskUrlQueries(v).slice(0, 120);
  }
  return out;
}

const HASH = /^[0-9a-f]{64}$/;
const VERDICT = /^[a-z_]{1,40}$/;

/**
 * Writes one evidence row. Never throws. A connector call must not go ahead when this returns ok: false ("no evidence, no call");
 * for the other kinds the action has already happened and the failure is logged.
 */
export async function recordEvidence(admin: AnyAdmin, e: Evidence): Promise<{ ok: true; id: number | null } | { ok: false; error: string }> {
  try {
    if (!e.userId) return { ok: false, error: "no account" };
    if (!VERDICT.test(e.verdict)) return { ok: false, error: "bad verdict" };
    for (const h of [e.inputSha256, e.outputSha256, e.rulesSha256]) if (h != null && !HASH.test(h)) return { ok: false, error: "bad hash" };
    if (typeof admin?.rpc !== "function") return { ok: false, error: "no database client" };
    const { data, error } = await admin.rpc("record_evidence", {
      _user_id: e.userId, _kind: e.kind, _actor: e.actor, _actor_id: e.actorId && ID.test(e.actorId) ? e.actorId : null,
      _subject: cleanSubject(e.subject), _input_sha256: e.inputSha256 ?? null, _output_sha256: e.outputSha256 ?? null,
      _rule_ids: (e.ruleIds ?? []).filter((r) => ID.test(r)).slice(0, 50), _rules_sha256: e.rulesSha256 ?? null, _verdict: e.verdict,
    });
    if (error) {
      console.error(`[security-evidence] ${e.kind} not recorded: ${String(error.message ?? error).slice(0, 200)}`);
      return { ok: false, error: String(error.message ?? "rpc failed") };
    }
    return { ok: true, id: typeof data === "number" ? data : data == null ? null : Number(data) };
  } catch (err) {
    console.error(`[security-evidence] ${e.kind} not recorded: ${err instanceof Error ? err.message.slice(0, 200) : "error"}`);
    return { ok: false, error: "exception" };
  }
}

/** The message outbound-guard.ts throws when it refuses a request (OutboundBlocked): the host and the credential's name. */
export const OUTBOUND_BLOCK_RE = /refused: the request to ([a-z0-9.-]{1,120}) carried a NazAI credential \(([A-Z0-9_]{1,80})\)/;

/**
 * The outbound guard patches fetch for a whole function and knows no account; a refusal surfaces as an error wherever the call was
 * made. Where that error meets an account (a step's tool call, an agent's tool), this records it: the host and the credential's name.
 */
export async function noteOutboundBlock(admin: AnyAdmin, userId: string, message: unknown, actor: EvidenceActor, actorId: string | null, subject: Evidence["subject"] = {}): Promise<boolean> {
  const text = typeof message === "string" ? message : message instanceof Error ? message.message : "";
  if (!userId) return false;
  const m = OUTBOUND_BLOCK_RE.exec(text);
  if (m) {
    await recordEvidence(admin, { userId, kind: "outbound_blocked", actor, actorId, subject: { ...subject, host: m[1], credential: m[2] }, verdict: "refused" });
    return true;
  }
  const g = OUTBOUND_EGRESS_RE.exec(text);
  if (!g) return false;
  await recordEvidence(admin, { userId, kind: "outbound_blocked", actor, actorId, subject: { ...subject, host: g[1], reason: g[2] }, verdict: "refused" });
  return true;
}

/** The message outbound-guard.ts throws when a destination is outside the egress allowlist (egress.ts): the host and the reason. */
export const OUTBOUND_EGRESS_RE = /refused: a request to ([a-z0-9.:\[\]-]{1,120}|an invalid address) is not allowed \(([^)]{1,200})\)/;

const refusedRecently = new Map<string, number>();
/** One access_refused row per key, reason and route every ten minutes: a key hammering a refused route is one fact, not a flood. */
export const ACCESS_REFUSED_EVERY_MS = 10 * 60_000;

/**
 * A request from a caller that belongs to an account was refused at the door (a paused key, a key without the needed scope). Recorded
 * with the key's id, the reason and the route, never the request. Best effort and never throws: the refusal has already been decided.
 */
export async function noteAccessRefused(admin: AnyAdmin, userId: string, keyId: string | null, reason: string, route: string, now = Date.now()): Promise<boolean> {
  if (!userId) return false;
  const k = `${userId}:${keyId ?? ""}:${reason}:${route}`;
  const last = refusedRecently.get(k);
  if (last !== undefined && now - last < ACCESS_REFUSED_EVERY_MS) return false;
  refusedRecently.set(k, now);
  if (refusedRecently.size > 2_000) for (const [key, at] of refusedRecently) if (now - at >= ACCESS_REFUSED_EVERY_MS) refusedRecently.delete(key);
  const r = await recordEvidence(admin, { userId, kind: "access_refused", actor: "api_key", actorId: keyId, subject: { reason, route: route.slice(0, 80) }, verdict: "refused" });
  return r.ok;
}

/** For tests. */
export function forgetRefusals(): void { refusedRecently.clear(); }

/** The refusal shown when a connector call could not get its evidence written. */
export const NO_EVIDENCE_MESSAGE = "Nothing was sent: the security evidence for this call could not be recorded, so the call was not made.";
