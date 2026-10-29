// Data encryption, fronts 3 and 4: the content columns below are stored encrypted (field-crypto.ts, DATA_KEY), and the server code does
// not have to know. withFieldEncryption(admin, keys) returns a client that behaves like the service client, except that for these
// tables every write puts the text into "<col>_enc" (encrypted, bound to its row) and empties "<col>", and every read gives the
// text back in "<col>" (rows not converted yet are read as stored). Nothing else changes: filters, ordering, counts and every other
// table go through untouched.
//
// What the database can not do with these columns any more is read them: no SQL may filter on them or look inside them (the CI
// guard in src/test/field-encryption.test.ts and the migration's notes list what was adjusted). Every edge function that reaches
// these tables wraps its client (also checked there).

import { redactDeep } from "./redact-secrets.ts";
import { dataKeysFromEnv, encColumn, openFields, sealFields as sealRow, sweepColumn, type FieldKeys } from "./field-crypto.ts";

/** Per table: the encrypted columns, and the value an omitted column gets on insert (the database default it replaces). */
/**
 * A few fields inside an encrypted JSON column that the database itself needs (to count, filter or join), copied to plain
 * columns on every write: small identifiers and flags, never content.
 */
type Projection = Record<string, Record<string, { col: string; type: "boolean" | "text" }>>;
/** redact: columns scrubbed of secrets before they are encrypted (what the redaction trigger did while they were plain). */
export type EncryptedTable = { cols: string[]; defaults?: Record<string, unknown>; project?: Projection; redact?: string[] };

export const ENCRYPTED_COLUMNS: Record<string, EncryptedTable> = {
  outer_control_sessions: {
    cols: ["objective", "context", "correction", "history", "next_input", "final_output", "pending_question", "pending_answer", "final_artifact"],
    defaults: { history: [] },
  },
  outer_control_session_steps: { cols: ["request", "reply_text", "note"] },
  outer_control_evaluations: { cols: ["input_excerpt", "output_text", "summary", "next_step", "changes"], defaults: { changes: [] } },
  outer_control_workflows: {
    cols: ["objective", "context", "summary", "final_output", "final_artifact", "goal_pool"],
    defaults: { goal_pool: [] },
  },
  outer_control_memory: { cols: ["summary", "data"] },
  outer_control_completion_checks: { cols: ["summary"] },
  // Data encryption, front 4: what visitors type into a generated website's forms (and their address), and the live data read
  // from a connected account (Gmail, Slack, Shopify…).
  website_form_submissions: { cols: ["fields", "submitter_ip"], defaults: { fields: {} } },
  integration_snapshots: { cols: ["data"], defaults: { data: {} } },
  // Agents: what a run was asked and how it ended, and each step's details and reasoning.
  agent_runs: { cols: ["instruction", "summary", "outcome"] },
  // What a Generator request asked for (and the page it produced), and the account's own knowledge-base text.
  missions: { cols: ["directive"] },
  knowledge_base_entries: { cols: ["entry_text"] },
  // The /respond API: an API key's own context entries, cached answers (and the question they answer), and logged questions.
  api_key_context_entries: { cols: ["entry_text"] },
  api_response_cache: { cols: ["message", "answer"] },
  api_response_generations: { cols: ["message"] },
  // An approval: what is being asked, the approver's comment, and what running it did (secrets removed first, as before).
  pending_approvals: { cols: ["description", "comment", "execution_summary"], defaults: { description: "" }, redact: ["execution_summary"] },
  agent_events: {
    cols: ["payload", "reasoning"], defaults: { payload: {} },
    project: { payload: {
      ok: { col: "payload_ok", type: "boolean" },
      ref: { col: "payload_ref", type: "text" },
      original_event_id: { col: "payload_original_event_id", type: "text" },
    } },
  },
};

/** The plain copies of the projected fields, for the values being written. */
export function projectedFields(spec: EncryptedTable, values: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [col, fields] of Object.entries(spec.project ?? {})) {
    if (!(col in values)) continue;
    const v = values[col] as Record<string, unknown> | null;
    for (const [key, { col: target, type }] of Object.entries(fields)) {
      const x = v && typeof v === "object" ? v[key] : undefined;
      out[target] = type === "boolean" ? (x === true ? true : x === false ? false : null) : x === undefined || x === null ? null : String(x);
    }
  }
  return out;
}

// deno-lint-ignore no-explicit-any
type AnyClient = any;
type Op = { m: string; a: unknown[] };
type Row = Record<string, unknown>;

const MUTATIONS = new Set(["insert", "upsert", "update"]);
/** Methods that only shape the result; everything else after from() is a filter that also applies to a per-row update. */
const SHAPERS = new Set(["select", "single", "maybeSingle", "order", "limit", "range", "csv", "abortSignal", "throwOnError", "returns"]);

/** Splits a select list at its top-level commas (embedded resources keep their parentheses). */
function splitSelect(s: string): string[] {
  const out: string[] = [];
  let depth = 0, cur = "";
  for (const ch of s) {
    if (ch === "(") depth++;
    if (ch === ")") depth--;
    if (ch === "," && depth === 0) { out.push(cur.trim()); cur = ""; } else cur += ch;
  }
  if (cur.trim()) out.push(cur.trim());
  return out;
}

/** The select list with "<col>_enc" (and the row id, needed to decrypt) added, and what to do to each result row afterwards. */
export function planSelect(cols: string[], sel: string | undefined) {
  const tokens = splitSelect(sel ?? "*");
  if (tokens.includes("*")) return { select: tokens.join(","), open: cols, renames: [] as [string, string][], dropId: false, drop: [] as string[] };
  const open: string[] = [], renames: [string, string][] = [], drop: string[] = [], extra: string[] = [];
  const plain = new Set<string>();
  for (const t of tokens) {
    if (t.includes("(")) continue;
    const [alias, base0] = t.includes(":") ? t.split(":", 2) : [t, t];
    const base = base0.split("::")[0].trim();
    plain.add(base);
    if (!cols.includes(base)) continue;
    if (base.includes("->")) throw new Error(`encrypted column ${base} can not be read into`);
    open.push(base);
    if (alias !== t) renames.push([alias.trim(), base]);
  }
  for (const c of open) { extra.push(encColumn(c)); if (!plain.has(c) || renames.some(([, b]) => b === c)) { extra.push(c); drop.push(c); } }
  const dropId = open.length > 0 && !plain.has("id");
  if (dropId) extra.push("id");
  return { select: [...tokens, ...new Set(extra)].join(","), open: [...new Set(open)], renames, dropId, drop };
}

/** A client whose reads and writes of the tables above encrypt and decrypt the content columns. */
export function withFieldEncryption(admin: AnyClient, keys: FieldKeys | Promise<FieldKeys | null>, opts: { keepPlainForTests?: boolean } = {}): AnyClient {
  const keysP = Promise.resolve(keys).then((k) => { if (!k) throw new Error("DATA_KEY is not configured"); return k; });
  return new Proxy(admin, {
    get(target, prop) {
      if (prop !== "from") {
        // Everything else is the client's own, called on the client itself (its internals never see the wrapper).
        const v = Reflect.get(target, prop, target);
        return typeof v === "function" ? v.bind(target) : v;
      }
      return (table: string) => {
        const spec = ENCRYPTED_COLUMNS[table];
        if (!spec) return target.from(table);
        return builder(target, table, spec, keysP, !!opts.keepPlainForTests);
      };
    },
  });
}

function builder(admin: AnyClient, table: string, spec: EncryptedTable, keysP: Promise<FieldKeys>, keepPlain: boolean) {
  const ops: Op[] = [];
  const proxy: AnyClient = new Proxy({}, {
    get(_t, prop) {
      if (prop === "then") return (ok: (v: unknown) => unknown, bad?: (e: unknown) => unknown) => run(admin, table, spec, keysP, ops, keepPlain).then(ok, bad);
      if (prop === "catch") return (bad: (e: unknown) => unknown) => run(admin, table, spec, keysP, ops, keepPlain).catch(bad);
      return (...a: unknown[]) => { ops.push({ m: String(prop), a }); return proxy; };
    },
  });
  return proxy;
}

function replay(admin: AnyClient, table: string, ops: Op[]) {
  let q = admin.from(table);
  for (const o of ops) q = q[o.m](...o.a);
  return q;
}

async function openResult(keys: FieldKeys, table: string, data: unknown, plan: ReturnType<typeof planSelect>): Promise<unknown> {
  const one = async (r: Row) => {
    if (!r || typeof r !== "object") return r;
    const present = plan.open.filter((c) => c in r || encColumn(c) in r);
    let o = present.length ? await openFields(keys, table, r, present) : { ...r };
    for (const c of Object.keys(o)) if (c.endsWith("_enc") && plan.open.includes(c.slice(0, -4))) delete o[c];
    for (const [alias, base] of plan.renames) o[alias] = o[base];
    for (const c of plan.drop) if (!plan.renames.some(([a]) => a === c)) delete o[c];
    if (plan.dropId) delete o.id;
    return o;
  };
  if (Array.isArray(data)) return await Promise.all(data.map((r) => one(r as Row)));
  return data && typeof data === "object" ? await one(data as Row) : data;
}

/** Filtering or sorting by an encrypted column would silently match or order nothing: refused, by name. */
function refuseUnreadable(table: string, cols: string[], ops: Op[]) {
  for (const o of ops) {
    if (MUTATIONS.has(o.m) || o.m === "select" || typeof o.a[0] !== "string") continue;
    const target = o.m === "or" ? String(o.a[0]) : String(o.a[0]).split(/->|::/)[0];
    const hit = o.m === "or" ? cols.find((c) => new RegExp(`(^|,|\\()${c}(\\.|->)`).test(target)) : cols.find((c) => c === target);
    if (hit) throw new Error(`${table}.${hit} is encrypted: it can not be used in ${o.m}()`);
  }
}

async function run(admin: AnyClient, table: string, spec: EncryptedTable, keysP: Promise<FieldKeys>, ops: Op[], keepPlain = false) {
  refuseUnreadable(table, spec.cols, ops);
  const keys = await keysP;
  // Tests of the engine only: the plain value is written too, so their checks on stored rows keep working; reads still decrypt.
  const sealFields = async (k: FieldKeys, t: string, id: string, values0: Row, cols: string[]) => {
    const values: Row = { ...values0 };
    for (const c of spec.redact ?? []) if (c in values && values[c] != null) values[c] = redactDeep(values[c]);
    const sealed = await sealRow(k, t, id, values, cols);
    if (keepPlain) for (const c of cols) if (c in values) sealed[c] = values[c];
    return sealed;
  };
  const mi = ops.findIndex((o) => MUTATIONS.has(o.m));
  const si = ops.findIndex((o) => o.m === "select");
  const plan = si >= 0 ? planSelect(spec.cols, ops[si].a[0] as string | undefined) : null;
  const shaped = ops.map((o, i) => (i === si && plan ? { m: o.m, a: [plan.select, ...o.a.slice(1)] } : o));
  const finish = async (res: { data: unknown; error: unknown }) => (plan && res && !res.error && res.data != null ? { ...res, data: await openResult(keys, table, res.data, plan) } : res);

  if (mi < 0) return await finish(await replay(admin, table, shaped));

  const mut = ops[mi];
  if (mut.m === "insert" || mut.m === "upsert") {
    const opts = mut.a[1] as { onConflict?: string } | undefined;
    const rows = (Array.isArray(mut.a[0]) ? mut.a[0] : [mut.a[0]]) as Row[];
    const sealed = await Promise.all(rows.map(async (r) => {
      if (mut.m === "upsert" && !r.id && opts?.onConflict && opts.onConflict !== "id") throw new Error(`upsert into ${table} on ${opts.onConflict} needs the row id (it is part of what is encrypted)`);
      const full: Row = { ...(spec.defaults ?? {}), ...r, id: r.id ?? crypto.randomUUID() };
      for (const k of Object.keys(spec.defaults ?? {})) if (!(k in r)) full[k] = spec.defaults![k];
      return { ...full, ...projectedFields(spec, full), ...(await sealFields(keys, table, String(full.id), full, spec.cols)) };
    }));
    const next = shaped.map((o, i) => (i === mi ? { m: o.m, a: [Array.isArray(mut.a[0]) ? sealed : sealed[0], ...o.a.slice(1)] } : o));
    return await finish(await replay(admin, table, next));
  }

  // update
  const patch = mut.a[0] as Row;
  if (!spec.cols.some((c) => c in patch)) return await finish(await replay(admin, table, shaped));
  const idOp = ops.find((o) => o.m === "eq" && o.a[0] === "id");
  if (idOp) {
    const sealedPatch = { ...patch, ...projectedFields(spec, patch), ...(await sealFields(keys, table, String(idOp.a[1]), patch, spec.cols)) };
    return await finish(await replay(admin, table, shaped.map((o, i) => (i === mi ? { m: "update", a: [sealedPatch, ...o.a.slice(1)] } : o))));
  }
  // No single row named: each matching row gets its own encrypted values (they are bound to the row), with the same conditions.
  const filters = ops.filter((o, i) => i !== mi && !SHAPERS.has(o.m));
  const { data: targets, error } = await replay(admin, table, [{ m: "select", a: ["id"] }, ...filters]);
  if (error) return { data: null, error };
  const out: unknown[] = [];
  for (const t of (targets ?? []) as Row[]) {
    const sealedPatch = { ...patch, ...projectedFields(spec, patch), ...(await sealFields(keys, table, String(t.id), patch, spec.cols)) };
    const rest = ops.filter((o, i) => i > mi && SHAPERS.has(o.m) && o.m !== "single" && o.m !== "maybeSingle");
    const res = await replay(admin, table, [{ m: "update", a: [sealedPatch] }, ...filters, { m: "eq", a: ["id", t.id] }, ...rest.map((o) => (o.m === "select" && plan ? { m: "select", a: [plan.select] } : o))]);
    if (res.error) return { data: null, error: res.error };
    if (Array.isArray(res.data)) out.push(...res.data);
  }
  const single = ops.some((o) => o.m === "single" || o.m === "maybeSingle");
  return await finish({ data: si > mi ? (single ? out[0] ?? null : out) : null, error: null });
}

/**
 * Converts what is left, a batch per column per run: plain values still in a listed column (rows written before encryption, or by
 * a path that does not encrypt) are encrypted, and values on a previous DATA_KEY are moved to the current one. Only the columns
 * encryption_report() shows work for are touched. Takes the plain service client (it reads the raw values).
 */
export async function sweepEncryptedColumns(plainAdmin: AnyClient, keys: FieldKeys | null, limit = 50) {
  const out = { encrypted: 0, reencrypted: 0, failed: 0, columns: 0 };
  if (!keys) return out;
  const { data, error } = await plainAdmin.rpc("encryption_report");
  if (error) throw new Error(`encryption_report: ${error.message}`);
  for (const r of (data ?? []) as { table_name: string; column_name: string; plain_rows: number | null; keys: Record<string, number> | null }[]) {
    if (!ENCRYPTED_COLUMNS[r.table_name]?.cols.includes(r.column_name)) continue;
    const onOldKey = Object.keys(r.keys ?? {}).some((k) => k !== keys.current.id);
    if (!(Number(r.plain_rows) > 0) && !onOldKey) continue;
    const res = await sweepColumn(plainAdmin, keys, r.table_name, r.column_name, { limit });
    out.encrypted += res.encrypted; out.reencrypted += res.reencrypted; out.failed += res.failed; out.columns++;
  }
  return out;
}

let envKeys: Promise<FieldKeys | null> | null = null;
/** DATA_KEY from the environment, imported once per function instance (null where it is not set, e.g. in tests). */
export function envDataKeys(): Promise<FieldKeys | null> {
  return envKeys ??= dataKeysFromEnv();
}

/**
 * Rows returned by a database function (an rpc) rather than a table read: each "<col>_enc" it returns is decrypted into "<col>"
 * (the row's id must be returned too, as "id" or the field named by idKey). Rows without encrypted values are returned as they are.
 */
export async function openRows<T extends Record<string, unknown>>(table: string, rows: T[], keys?: FieldKeys | null, idKey = "id"): Promise<T[]> {
  const cols = ENCRYPTED_COLUMNS[table]?.cols ?? [];
  if (!rows?.length || !cols.length) return rows;
  const k = keys === undefined ? await envDataKeys() : keys;
  return await Promise.all(rows.map(async (r) => {
    const present = cols.filter((c) => c in r || encColumn(c) in r);
    if (!present.some((c) => r[encColumn(c)])) {
      const o: Record<string, unknown> = { ...r };
      for (const c of present) delete o[encColumn(c)];
      return o as T;
    }
    if (!k) throw new Error(`${table}: encrypted values but DATA_KEY is not configured`);
    if (idKey === "id") return await openFields(k, table, r, present);
    // The row's own id is in another field (the function returns a different id as "id").
    const opened = await openFields(k, table, { ...r, id: r[idKey] }, present);
    return { ...opened, id: r.id } as T;
  }));
}
