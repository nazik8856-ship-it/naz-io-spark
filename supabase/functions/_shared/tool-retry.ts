// Self-correcting tool-call wrapper for the agent engine.
//
// Wraps ANY tool executor so that:
//   1. Errors (thrown exceptions, ok:false results, Zod validation failures)
//      are caught instead of killing the run.
//   2. The error message + stack trace is fed BACK to the model, which is asked
//      to emit corrected input — but only for error classes a model can
//      actually fix (malformed/invalid input, validation errors, bad
//      formatting, transient/network blips).
//   3. Auth / credential / permission / quota errors are NOT retried. Retrying
//      them just burns steps: the model cannot mint a token. They are surfaced
//      straight to the user with a plain-language explanation.
//   4. Every attempt — the error, its classification, and the model's
//      correction — is logged as an `agent_events` row so failures are
//      debuggable rather than silent.
//
// Hard ceiling: MAX_TOOL_ATTEMPTS total attempts (initial + retries). There is
// no path through this module that can loop indefinitely.
import { validateToolInput } from "./tool-schemas.ts";

export const MAX_TOOL_ATTEMPTS = 3; // 1 initial attempt + up to 2 corrections

export type ToolErrorCategory =
  | "validation_error"     // Zod input-schema failure — model-correctable
  | "malformed_input"      // bad shape/parse/format at the provider — correctable
  | "not_found"            // wrong id/target — correctable (model can pick another)
  | "rate_limit"           // transient — correctable by waiting/retrying
  | "transient"            // network/5xx/timeout — correctable by retrying
  | "auth_error"           // expired/missing/invalid credentials — NOT correctable
  | "permission_error"     // scope/forbidden — NOT correctable
  | "quota_error"          // billing/credits exhausted — NOT correctable
  | "unknown";             // unclassified — retried once, conservatively

export type ToolErrorInfo = {
  category: ToolErrorCategory;
  retryable: boolean;
  /** Plain-English explanation safe to show a non-technical user. */
  humanMessage: string;
  /** Raw technical detail for the log / the model. */
  technical: string;
  stack?: string;
  status?: number;
};

const NON_RETRYABLE: ToolErrorCategory[] = ["auth_error", "permission_error", "quota_error"];

/** Human-facing guidance per category (never jargon). */
const HUMAN_HINT: Record<ToolErrorCategory, string> = {
  validation_error: "The details sent to this tool weren't valid, so nothing was run.",
  malformed_input: "The information sent to this tool wasn't in a form it understood.",
  not_found: "The item this tool was pointed at couldn't be found.",
  rate_limit: "This service asked us to slow down, so the request was turned away for now.",
  transient: "The service didn't respond properly — this usually clears up on a retry.",
  auth_error: "This connection needs to be signed in again before it can be used.",
  permission_error: "This account doesn't have permission to do that.",
  quota_error: "This account has run out of allowance for this service.",
  unknown: "Something went wrong while running this tool.",
};

/**
 * Classify a tool failure from whatever we have: a thrown Error, an HTTP
 * status, and/or the executor's own summary/error text.
 */
export function classifyToolError(raw: {
  error?: unknown;
  status?: number;
  message?: string;
  code?: string;
}): ToolErrorInfo {
  const err = raw.error;
  const stack = err instanceof Error ? err.stack ?? undefined : undefined;
  const text = [
    raw.message,
    raw.code,
    err instanceof Error ? err.message : typeof err === "string" ? err : "",
  ].filter(Boolean).join(" ").toLowerCase();
  const status = raw.status;

  let category: ToolErrorCategory = "unknown";

  if (status === 401 || /\b(401|unauthori[sz]ed|invalid[_ ]grant|token (has )?expired|expired token|invalid token|not authenticated|reconnect|re-?authoriz)/.test(text)) {
    category = "auth_error";
  } else if (status === 403 || /\b(403|forbidden|permission|insufficient (scope|permission)|access denied|not authorized|scope)/.test(text)) {
    category = "permission_error";
  } else if (status === 402 || /\b(402|quota|billing|credits? (exhausted|exceeded)|payment required|out of credits)/.test(text)) {
    category = "quota_error";
  } else if (status === 429 || /\b(429|rate limit|too many requests|slow down)/.test(text)) {
    category = "rate_limit";
  } else if (status === 404 || /\b(404|not found|no such|does not exist|missing resource)/.test(text)) {
    category = "not_found";
  } else if (
    status === 400 || status === 422 ||
    /\b(400|422|validation|invalid (argument|value|request|email|url|format|json|parameter)|malformed|bad request|required (field|parameter)|parse error|unexpected token)/.test(text)
  ) {
    category = "malformed_input";
  } else if (
    (typeof status === "number" && status >= 500) ||
    /\b(5\d\d|timeout|timed out|econnreset|network|fetch failed|socket|temporar|unavailable)/.test(text)
  ) {
    category = "transient";
  }

  const technical = [
    status ? `status=${status}` : "",
    err instanceof Error ? `${err.name}: ${err.message}` : "",
    raw.message || "",
  ].filter(Boolean).join(" | ").slice(0, 800) || "unknown error";

  return {
    category,
    retryable: !NON_RETRYABLE.includes(category),
    humanMessage: HUMAN_HINT[category],
    technical,
    stack: stack?.slice(0, 1500),
    status,
  };
}

export type ToolAttemptLog = {
  attempt: number;
  input: Record<string, unknown>;
  ok: boolean;
  category?: ToolErrorCategory;
  retryable?: boolean;
  error?: string;
  stack?: string;
  /** What the model changed on the following attempt (null on the last one). */
  correction?: string | null;
};

export type ToolRunOutcome<R> = {
  ok: boolean;
  result?: R;
  attempts: ToolAttemptLog[];
  /** Present when ok === false. */
  failure?: ToolErrorInfo & {
    /** True when we stopped because the error class is not model-correctable. */
    surfacedToUser: boolean;
    /** True when we stopped because the attempt ceiling was hit. */
    exhausted: boolean;
    /** Plain-English sentence intended for the end user. */
    userMessage: string;
  };
  /** The input that finally worked (or the last one tried). */
  finalInput: Record<string, unknown>;
};

type Executor<R> = (input: Record<string, unknown>) => Promise<R>;

/**
 * Ask the model to repair the input given the exact error + stack. Return the
 * corrected input object, or null to give up. Implemented by the caller so this
 * module stays free of gateway/model coupling.
 */
export type Corrector = (ctx: {
  tool: string;
  kind: string;
  input: Record<string, unknown>;
  error: ToolErrorInfo;
  attempt: number;
  maxAttempts: number;
}) => Promise<{ input: Record<string, unknown>; explanation: string } | null>;

export type ToolLogger = (kind: string, payload: Record<string, unknown>) => Promise<unknown>;

/**
 * Run a tool with schema validation, bounded self-correction and full audit
 * logging. `isFailure` lets callers treat an `ok:false`-style result object as
 * a failure without throwing.
 */
export async function runToolWithSelfCorrection<R>(opts: {
  tool: string;
  kind: string;
  input: Record<string, unknown>;
  execute: Executor<R>;
  /** Inspect a returned (non-thrown) result and report failure details. */
  isFailure?: (result: R) => { failed: boolean; message?: string; status?: number };
  correct: Corrector;
  logEvent: ToolLogger;
  maxAttempts?: number;
}): Promise<ToolRunOutcome<R>> {
  const maxAttempts = Math.max(1, Math.min(opts.maxAttempts ?? MAX_TOOL_ATTEMPTS, MAX_TOOL_ATTEMPTS));
  const attempts: ToolAttemptLog[] = [];
  let input = opts.input;
  let lastError: ToolErrorInfo | null = null;

  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    // ---- 1. Zod input gate (never execute on invalid input) ----
    const validation = validateToolInput(opts.kind, opts.tool, input);
    if (!validation.success) {
      lastError = {
        category: "validation_error",
        retryable: true,
        humanMessage: validation.humanMessage,
        technical: `validation_error: ${validation.message}`,
      };
      const corrected = attempt < maxAttempts
        ? await opts.correct({ tool: opts.tool, kind: opts.kind, input, error: lastError, attempt, maxAttempts })
        : null;
      attempts.push({
        attempt,
        input,
        ok: false,
        category: "validation_error",
        retryable: true,
        error: lastError.technical,
        correction: corrected?.explanation ?? null,
      });
      await opts.logEvent("tool_retry", {
        tool: opts.tool,
        kind: opts.kind,
        attempt,
        max_attempts: maxAttempts,
        category: "validation_error",
        retryable: true,
        message: lastError.humanMessage,
        technical: lastError.technical,
        details: validation.details,
        input,
        correction: corrected?.explanation ?? null,
        corrected_input: corrected?.input ?? null,
        will_retry: !!corrected,
      });
      if (!corrected) break;
      input = corrected.input;
      continue;
    }
    input = validation.data as Record<string, unknown>;

    // ---- 2. Execute, catching everything ----
    let result: R | undefined;
    let info: ToolErrorInfo | null = null;
    try {
      result = await opts.execute(input);
      const check = opts.isFailure?.(result);
      if (check?.failed) {
        info = classifyToolError({ message: check.message, status: check.status });
      }
    } catch (e) {
      info = classifyToolError({ error: e });
    }

    // ---- 3. Success ----
    if (!info) {
      attempts.push({ attempt, input, ok: true, correction: null });
      if (attempt > 1) {
        await opts.logEvent("tool_retry_succeeded", {
          tool: opts.tool,
          kind: opts.kind,
          attempt,
          max_attempts: maxAttempts,
          message: `"${opts.tool}" worked on attempt ${attempt} after correcting the earlier problem.`,
        });
      }
      return { ok: true, result: result as R, attempts, finalInput: input };
    }

    lastError = info;

    // ---- 4. Non-correctable class → stop immediately, surface to user ----
    if (!info.retryable) {
      attempts.push({
        attempt, input, ok: false,
        category: info.category, retryable: false,
        error: info.technical, stack: info.stack, correction: null,
      });
      await opts.logEvent("tool_error", {
        tool: opts.tool,
        kind: opts.kind,
        attempt,
        category: info.category,
        retryable: false,
        message: info.humanMessage,
        technical: info.technical,
        stack: info.stack,
        surfaced_to_user: true,
      });
      break;
    }

    // ---- 5. Correctable → ask the model to fix it, if budget remains ----
    const corrected = attempt < maxAttempts
      ? await opts.correct({ tool: opts.tool, kind: opts.kind, input, error: info, attempt, maxAttempts })
      : null;

    attempts.push({
      attempt, input, ok: false,
      category: info.category, retryable: true,
      error: info.technical, stack: info.stack,
      correction: corrected?.explanation ?? null,
    });
    await opts.logEvent("tool_retry", {
      tool: opts.tool,
      kind: opts.kind,
      attempt,
      max_attempts: maxAttempts,
      category: info.category,
      retryable: true,
      message: info.humanMessage,
      technical: info.technical,
      stack: info.stack,
      input,
      correction: corrected?.explanation ?? null,
      corrected_input: corrected?.input ?? null,
      will_retry: !!corrected,
    });

    if (!corrected) break;
    input = corrected.input;
  }

  const err = lastError ?? classifyToolError({ message: "unknown failure" });
  const exhausted = err.retryable;
  const userMessage = err.retryable
    ? `${err.humanMessage} We tried ${attempts.length} time${attempts.length === 1 ? "" : "s"} and it still didn't work, so nothing was completed.`
    : `${err.humanMessage} Retrying won't help — this needs you to fix the connection or permissions.`;

  await opts.logEvent("tool_failed", {
    tool: opts.tool,
    kind: opts.kind,
    category: err.category,
    attempts: attempts.length,
    max_attempts: maxAttempts,
    exhausted,
    surfaced_to_user: !err.retryable,
    message: userMessage,
    technical: err.technical,
    stack: err.stack,
    attempt_log: attempts,
  });

  return {
    ok: false,
    attempts,
    finalInput: input,
    failure: { ...err, surfacedToUser: !err.retryable, exhausted, userMessage },
  };
}

/** Prompt used to ask the model for corrected tool input. */
export function buildCorrectionPrompt(ctx: {
  tool: string;
  kind: string;
  input: Record<string, unknown>;
  error: ToolErrorInfo;
  attempt: number;
  maxAttempts: number;
}): string {
  return [
    `The tool "${ctx.tool}" (kind: ${ctx.kind}) failed on attempt ${ctx.attempt} of ${ctx.maxAttempts}.`,
    `Error type: ${ctx.error.category}`,
    `Error: ${ctx.error.technical}`,
    ctx.error.stack ? `Stack trace:\n${ctx.error.stack}` : "",
    `Input that failed:\n${JSON.stringify(ctx.input).slice(0, 2000)}`,
    "",
    "Return ONLY a fenced JSON block of the form:",
    '```json',
    '{"input":{...corrected input...},"explanation":"one short sentence on what you changed"}',
    '```',
    "Fix the specific field(s) implicated by the error. Do not repeat the same input unchanged.",
    'If the error cannot be fixed by changing the input, return {"input":null,"explanation":"why"}.',
  ].filter(Boolean).join("\n");
}
