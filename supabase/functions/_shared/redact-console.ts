// Every edge function imports this first: from then on everything written to the console (by NazAI's code or by any library it
// uses) passes through redactSecrets / redactDeep before it reaches the function logs. A secret in an error message, a provider's
// response or a logged object is replaced by [REDACTED:secrets]; the rest of the line stays as it was.
import { redactDeep, redactSecrets } from "./redact-secrets.ts";

const MARK = Symbol.for("nazai.redact-console");
type Patched = typeof globalThis & { [MARK]?: boolean };

/** What a console argument becomes: strings scrubbed, errors kept as errors (message and stack scrubbed), objects scrubbed. */
export function redactForLog(arg: unknown): unknown {
  if (typeof arg === "string") return redactSecrets(arg);
  return redactDeep(arg);
}

/** Wraps console.log/info/warn/error/debug/trace once per isolate; calling it again does nothing. */
export function installRedactingConsole(): void {
  const g = globalThis as Patched;
  if (g[MARK]) return;
  g[MARK] = true;
  for (const method of ["log", "info", "warn", "error", "debug", "trace"] as const) {
    const original = console[method].bind(console);
    console[method] = (...args: unknown[]) => original(...args.map(redactForLog));
  }
}

installRedactingConsole();
