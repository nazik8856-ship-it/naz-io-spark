// General data security, task 4: cross-platform boundary control (docs/cross-platform-boundary.md).
//
// Outer Control moves an account's content between NazAI and the tools that account connected. Three things keep it inside that
// account and that run:
//   - a tool is only ever loaded for the account that owns it (resolveSessionTool, accountTools; the database refuses a session,
//     a step or a workflow that points at another account's tool, workflow or project);
//   - a run NazAI starts on one of the account's own agents carries a short-lived signed token naming the account, the Task, the
//     step and the agent; agent-runtime refuses an Outer Control run whose token is missing, expired or names anything else;
//   - a vault secret belongs to one account (the database refuses a row that points at another account's secret).
import { timingSafeEqual } from "./timing-safe.ts";
import type { FieldKeys } from "./field-crypto.ts";

// deno-lint-ignore no-explicit-any
type AnyAdmin = any;

/** The tool of a session (or a step): loaded only when it belongs to the session's own account and has not been removed. */
export async function resolveSessionTool<T = Record<string, unknown>>(
  admin: AnyAdmin, session: { user_id: string; tool_id?: string | null }, toolId: string | null | undefined = session.tool_id, cols = "*",
): Promise<T | null> {
  if (!toolId || !session.user_id) return null;
  const { data } = await admin.from("external_tools").select(cols).eq("id", toolId).eq("user_id", session.user_id).is("removed_at", null).maybeSingle();
  return (data as T | null) ?? null;
}

/** Several tools of one account by id (names for a report, a pool); ids of other accounts are simply not found. */
export async function accountTools<T = Record<string, unknown>>(admin: AnyAdmin, accountId: string, ids: string[], cols: string): Promise<T[]> {
  if (!ids.length || !accountId) return [];
  const { data } = await admin.from("external_tools").select(cols).eq("user_id", accountId).in("id", ids);
  return ((data ?? []) as T[]);
}

// ---------------------------------------------------------------------------------------------------------------------------
// Run tokens

/** What a run token says: whose run it is, for which Task and step, on which agent, until when (epoch seconds). */
export type RunClaims = { account: string; task: string | null; session: string; agent: string; exp: number };
export const RUN_TOKEN_SECONDS = 15 * 60;
export const RUN_TOKEN_HEADER = "x-outer-control-token";

const enc = new TextEncoder();
const b64url = (b: Uint8Array) => btoa(String.fromCharCode(...b)).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
const fromB64url = (s: string) => Uint8Array.from(atob(s.replace(/-/g, "+").replace(/_/g, "/") + "===".slice((s.length + 3) % 4)), (c) => c.charCodeAt(0));
const hex = (b: Uint8Array) => [...b].map((x) => x.toString(16).padStart(2, "0")).join("");
const PURPOSE = "outer-control run v1\n";

async function sign(key: CryptoKey, body: string): Promise<string> {
  return hex(new Uint8Array(await crypto.subtle.sign("HMAC", key, enc.encode(PURPOSE + body))));
}

/** A token for one run: valid for RUN_TOKEN_SECONDS, signed with the token key derived from DATA_KEY. */
export async function signRunToken(keys: FieldKeys, claims: Omit<RunClaims, "exp">, nowMs = Date.now()): Promise<string> {
  const full: RunClaims = { ...claims, exp: Math.floor(nowMs / 1000) + RUN_TOKEN_SECONDS };
  const body = b64url(enc.encode(JSON.stringify(full)));
  return `v1.${body}.${await sign(keys.current.token, body)}`;
}

export type RunCheck = { ok: true; claims: RunClaims } | { ok: false; reason: "missing" | "malformed" | "bad_signature" | "expired" | "mismatch" };

/** Whether the token is genuine, unexpired, and names exactly this account, Task, step and agent. */
export async function verifyRunToken(
  keys: FieldKeys, token: string | null | undefined, expect: Omit<RunClaims, "exp">, nowMs = Date.now(),
): Promise<RunCheck> {
  if (!token) return { ok: false, reason: "missing" };
  const parts = token.split(".");
  if (parts.length !== 3 || parts[0] !== "v1" || !/^[A-Za-z0-9_-]+$/.test(parts[1]) || !/^[0-9a-f]{64}$/.test(parts[2])) return { ok: false, reason: "malformed" };
  let genuine = false;
  for (const k of [keys.current, keys.previous]) if (k && timingSafeEqual(await sign(k.token, parts[1]), parts[2])) genuine = true;
  if (!genuine) return { ok: false, reason: "bad_signature" };
  let claims: RunClaims;
  try { claims = JSON.parse(new TextDecoder().decode(fromB64url(parts[1]))); } catch { return { ok: false, reason: "malformed" }; }
  if (typeof claims.exp !== "number" || claims.exp * 1000 < nowMs) return { ok: false, reason: "expired" };
  const same = claims.account === expect.account && claims.session === expect.session && claims.agent === expect.agent && (claims.task ?? null) === (expect.task ?? null);
  return same ? { ok: true, claims } : { ok: false, reason: "mismatch" };
}
