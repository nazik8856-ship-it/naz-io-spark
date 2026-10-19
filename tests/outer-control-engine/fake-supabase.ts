// In-memory stand-in for supabase-js, just enough for the edge functions under test.
export const db: Record<string, any[]> = {};
export const rpcCalls: { name: string; args: any }[] = [];
export const state = { user: { id: "user-1" } as any, rpc: {} as Record<string, any>, uploadError: null as any };
export const storage = { uploaded: [] as string[], removed: [] as string[] };
let idc = 0;
export function reset() { for (const k of Object.keys(db)) delete db[k]; rpcCalls.length = 0; storage.uploaded.length = 0; storage.removed.length = 0; state.uploadError = null; state.user = { id: "user-1" }; state.rpc = {}; idc = 0; }
export const table = (n: string) => (db[n] ??= []);

class Q {
  private filters: ((r: any) => boolean)[] = [];
  private mode: "select" | "insert" | "update" | "delete" | "upsert" = "select";
  private payload: any; private opts: any; private single_ = false; private maybe_ = false; private lim: number | null = null; private ord: { col: string; asc: boolean } | null = null;
  private inserted: any[] = [];
  constructor(private t: string) {}
  private sel = false;
  select(_c?: string) { this.sel = true; return this; }
  insert(p: any) { this.mode = "insert"; this.payload = p; return this; }
  upsert(p: any, o?: any) { this.mode = "upsert"; this.payload = p; this.opts = o; return this; }
  update(p: any) { this.mode = "update"; this.payload = p; return this; }
  delete() { this.mode = "delete"; return this; }
  eq(c: string, v: any) { this.filters.push((r) => r[c] === v); return this; }
  is(c: string, v: any) { this.filters.push((r) => (r[c] ?? null) === v); return this; }
  in(c: string, vs: any[]) { this.filters.push((r) => vs.includes(r[c])); return this; }
  neq(c: string, v: any) { this.filters.push((r) => r[c] !== v); return this; }
  gte(c: string, v: any) { this.filters.push((r) => r[c] >= v); return this; }
  lte(c: string, v: any) { this.filters.push((r) => r[c] <= v); return this; }
  or(expr: string) {
    const parts = expr.split(/,(?=[a-z_]+\.)/).map((p) => { const m = p.match(/^([a-z_]+)\.(is|lt|gt|eq)\.(.*)$/)!; return { c: m[1], op: m[2], v: m[3] }; });
    this.filters.push((r) => parts.some((p) => p.op === "is" ? (r[p.c] ?? null) === (p.v === "null" ? null : p.v) : p.op === "lt" ? (r[p.c] ?? null) !== null && r[p.c] < p.v : p.op === "gt" ? r[p.c] > p.v : String(r[p.c]) === p.v));
    return this;
  }
  gt(c: string, v: any) { this.filters.push((r) => r[c] > v); return this; }
  lt(c: string, v: any) { this.filters.push((r) => r[c] < v); return this; }
  order(c: string, o?: any) { this.ord = { col: c, asc: o?.ascending !== false }; return this; }
  limit(n: number) { this.lim = n; return this; }
  single() { this.single_ = true; return this; }
  maybeSingle() { this.maybe_ = true; return this; }
  private run(): { data: any; error: any } {
    const rows = table(this.t);
    if (this.mode === "insert" || this.mode === "upsert") {
      const arr = Array.isArray(this.payload) ? this.payload : [this.payload];
      for (const raw of arr) {
        const row = { ...raw };
        if (this.mode === "upsert" && this.opts?.onConflict) {
          const keys = this.opts.onConflict.split(",");
          const ex = rows.find((r) => keys.every((k: string) => r[k] === row[k]));
          if (ex) { Object.assign(ex, row); this.inserted.push(ex); continue; }
        }
        if (this.t === "outer_control_evaluations" && row.external_id && rows.some((r) => r.user_id === row.user_id && r.api_key_id === row.api_key_id && r.external_id === row.external_id)) return { data: null, error: { code: "23505", message: "duplicate key" } };
        if (this.t === "outer_control_sessions") { const now = new Date().toISOString(); for (const [k, v] of Object.entries({ status: "running", step_count: 0, max_steps: 5, max_retries: 1, retries_used: 0, failures_used: 0, history: [], gate_cleared_step: 0, waited_ms: 0, attempt_base: 0, fallback_used: false, on_failure: "handoff", depends_on: [], align_used: 0, started_at: now, updated_at: now })) if (row[k] === undefined) row[k] = JSON.parse(JSON.stringify(v)); }
        if (!row.id && this.t !== "generation_progress") row.id = `${this.t}-${++idc}`;
        rows.push(row); this.inserted.push(row);
      }
      const out = this.inserted.map((r) => ({ ...r }));
      return { data: (this.single_ || this.maybe_) ? out[0] ?? null : out, error: null };
    }
    let m = rows.filter((r) => this.filters.every((f) => f(r)));
    if (this.mode === "update") {
      m.forEach((r) => Object.assign(r, this.payload));
      if (!this.sel) return { data: null, error: null };
      const outU = m.map((r) => JSON.parse(JSON.stringify(r)));
      return { data: (this.single_ || this.maybe_) ? outU[0] ?? null : outU, error: null };
    }
    if (this.mode === "delete") { for (const r of m) rows.splice(rows.indexOf(r), 1); return { data: null, error: null }; }
    if (this.ord) m = [...m].sort((a, b) => (a[this.ord!.col] > b[this.ord!.col] ? 1 : -1) * (this.ord!.asc ? 1 : -1));
    if (this.lim != null) m = m.slice(0, this.lim);
    const out = m.map((r) => JSON.parse(JSON.stringify(r)));
    if (this.single_ || this.maybe_) return { data: out[0] ?? null, error: null };
    return { data: out, error: null };
  }
  then(res: any, rej?: any) { return Promise.resolve(this.run()).then(res, rej); }
}
export function createClient(_u: string, _k: string, _o?: any) {
  return {
    auth: { getUser: async () => ({ data: { user: state.user } }) },
    from: (t: string) => permissive(new Q(t)),
    rpc: async (name: string, args: any) => { rpcCalls.push({ name, args }); const v = state.rpc[name]; return { data: typeof v === "function" ? v(args) : v ?? null, error: null }; },
    storage: { from: () => ({
      upload: async (path: string, _b: any, o: any) => { storage.uploaded.push(path); return { error: state.uploadError ?? null }; },
      remove: async (paths: string[]) => { storage.removed.push(...paths); return { error: null }; },
    }) },
  };
}

function permissive(q: any) {
  return new Proxy(q, { get(t, p, r) { if (p in t) { const v = Reflect.get(t, p, r); return typeof v === "function" ? v.bind(t) : v; } if (p === "then") return undefined; return () => r; } });
}
