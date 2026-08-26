// "15 more items" plan, item 12: a small, hand-written TypeScript client
// for NazAI's public Control API (see supabase/functions/control-api and
// src/pages/ControlApiDocs.tsx for the underlying HTTP contract this
// wraps). Deliberately NOT generated from an OpenAPI spec -- the API is
// two endpoints' worth of surface today, and a hand-written client stays
// small and readable rather than dragging in codegen tooling for three
// methods.
//
// Handles the one thing every integrator would otherwise rewrite: the
// Authorization: Bearer nazai_sk_... header, JSON encoding/decoding, and
// mapping the API's snake_case response fields onto a typed camelCase
// result -- for both verdict modes (fast/full) and for a batch of actions.

export type ControlApiVerdict = "allow" | "modify" | "block" | "deferred";
export type ControlApiMode = "fast" | "full";

export interface ControlApiActionInput {
  /** What you're about to do, e.g. "send_email". */
  actionType: string;
  /** Which system it targets, e.g. "Gmail". Defaults to "unknown". */
  provider?: string;
  /** Plain-language description of what this action does. */
  description: string;
  /** The actual payload of the action. */
  params?: Record<string, unknown>;
  /** "fast" (default): deterministic checks only. "full": adds the LLM-scored assessment. */
  mode?: ControlApiMode;
}

export interface ControlApiVerdictResult {
  verdict: ControlApiVerdict;
  reason: string | null;
  decisionId: string | null;
  gateSource: string | null;
  confidenceScore: number | null;
  modification: unknown;
  policyVersion: string | null;
  mode: ControlApiMode;
}

export interface ControlApiBatchResultEntry extends ControlApiVerdictResult {
  index: number;
  error?: string;
  message?: string;
}

export interface ControlApiBatchResult {
  batch: true;
  count: number;
  results: ControlApiBatchResultEntry[];
}

export interface ControlApiDecisionRow {
  id: string;
  decision: string;
  reasoning: string | null;
  confidenceScore: number | null;
  escalated: boolean;
  source: string | null;
  agentId: string | null;
  actionType: string;
  provider: string;
  policyVersion: number | null;
  createdAt: string;
}

export interface ControlApiDecisionPage {
  decisions: ControlApiDecisionRow[];
  hasMore: boolean;
  /** Pass this back as `cursor` on the next call to continue exactly where this page left off. */
  nextCursor: string | null;
}

export interface ListDecisionsOptions {
  /** ISO 8601 timestamp -- only decisions at or after this time. Ignored once you're paging via cursor. */
  since?: string;
  /** From a previous page's nextCursor -- continues from exactly that point. */
  cursor?: string;
  /** 1-500, defaults to 100. */
  limit?: number;
}

export interface ControlApiClientOptions {
  /** Your nazai_sk_... API key, from the Control System's API Keys page. */
  apiKey: string;
  /** Your NazAI project's Supabase Functions base URL, e.g. "https://<ref>.supabase.co/functions/v1". */
  baseUrl: string;
  /** Override for testing; defaults to the global fetch. */
  fetchImpl?: typeof fetch;
}

export class ControlApiError extends Error {
  readonly status: number;
  readonly body: unknown;
  constructor(message: string, status: number, body: unknown) {
    super(message);
    this.name = "ControlApiError";
    this.status = status;
    this.body = body;
  }
}

function toVerdictResult(data: Record<string, unknown>): ControlApiVerdictResult {
  return {
    verdict: (data.verdict as ControlApiVerdict) ?? "block",
    reason: (data.reason as string | null) ?? null,
    decisionId: (data.decision_id as string | null) ?? null,
    gateSource: (data.gate_source as string | null) ?? null,
    confidenceScore: (data.confidence_score as number | null) ?? null,
    modification: data.modification ?? null,
    policyVersion: (data.policy_version as string | null) ?? null,
    mode: (data.mode as ControlApiMode) ?? "fast",
  };
}

function toRequestBody(action: ControlApiActionInput): Record<string, unknown> {
  return {
    action_type: action.actionType,
    provider: action.provider,
    description: action.description,
    params: action.params,
    mode: action.mode,
  };
}

function toDecisionRow(d: Record<string, unknown>): ControlApiDecisionRow {
  return {
    id: String(d.id),
    decision: String(d.decision),
    reasoning: (d.reasoning as string | null) ?? null,
    confidenceScore: (d.confidence_score as number | null) ?? null,
    escalated: Boolean(d.escalated),
    source: (d.source as string | null) ?? null,
    agentId: (d.agent_id as string | null) ?? null,
    actionType: String(d.action_type),
    provider: String(d.provider),
    policyVersion: (d.policy_version as number | null) ?? null,
    createdAt: String(d.created_at),
  };
}

export class ControlApiClient {
  private readonly apiKey: string;
  private readonly baseUrl: string;
  private readonly fetchImpl: typeof fetch;

  constructor(options: ControlApiClientOptions) {
    if (!options.apiKey) throw new Error("ControlApiClient requires an apiKey (nazai_sk_...)");
    if (!options.baseUrl) throw new Error("ControlApiClient requires baseUrl -- your NazAI project's Supabase Functions URL");
    this.apiKey = options.apiKey;
    this.baseUrl = options.baseUrl.replace(/\/+$/, "");
    this.fetchImpl = options.fetchImpl ?? fetch;
  }

  private endpoint(): string {
    return `${this.baseUrl}/control-api/v1`;
  }

  private async handleResponse(res: Response): Promise<Record<string, unknown>> {
    const data = (await res.json().catch(() => ({}))) as Record<string, unknown>;
    if (!res.ok) {
      throw new ControlApiError(
        String(data?.message || data?.error || `Control API request failed (${res.status})`),
        res.status,
        data,
      );
    }
    return data;
  }

  private async post(body: unknown): Promise<Record<string, unknown>> {
    const res = await this.fetchImpl(this.endpoint(), {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${this.apiKey}` },
      body: JSON.stringify(body),
    });
    return this.handleResponse(res);
  }

  /** Check a single action and get back one verdict. */
  async check(action: ControlApiActionInput): Promise<ControlApiVerdictResult> {
    const data = await this.post(toRequestBody(action));
    return toVerdictResult(data);
  }

  /** Check up to 50 actions in one request and get back one verdict per action, in order. */
  async checkBatch(actions: ControlApiActionInput[]): Promise<ControlApiBatchResult> {
    const data = await this.post({ actions: actions.map(toRequestBody) });
    const results = ((data.results as Record<string, unknown>[]) ?? []).map((r) => ({
      ...toVerdictResult(r),
      index: Number(r.index),
      ...(r.error ? { error: String(r.error) } : {}),
      ...(r.message ? { message: String(r.message) } : {}),
    }));
    return { batch: true, count: Number(data.count ?? results.length), results };
  }

  /** Pull one page of this account's decision history, newest-first-safe via cursor pagination -- see ListDecisionsOptions. */
  async listDecisions(opts: ListDecisionsOptions = {}): Promise<ControlApiDecisionPage> {
    const params = new URLSearchParams();
    if (opts.since) params.set("since", opts.since);
    if (opts.cursor) params.set("cursor", opts.cursor);
    if (opts.limit) params.set("limit", String(opts.limit));
    const qs = params.toString();
    const res = await this.fetchImpl(`${this.endpoint()}/decisions${qs ? `?${qs}` : ""}`, {
      method: "GET",
      headers: { Authorization: `Bearer ${this.apiKey}` },
    });
    const data = await this.handleResponse(res);
    return {
      decisions: ((data.decisions as Record<string, unknown>[]) ?? []).map(toDecisionRow),
      hasMore: Boolean(data.has_more),
      nextCursor: (data.next_cursor as string | null) ?? null,
    };
  }
}
