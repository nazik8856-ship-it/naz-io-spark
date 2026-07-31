import { useCallback, useRef, useState } from "react";

/**
 * Shared live execution-log state.
 *
 * Every long-running NazAI action (agent deploy, agent run, website edit,
 * OAuth connect) drives this hook instead of a generic spinner. Steps are
 * advanced by REAL progress events — never a fixed timer — so the UI always
 * reflects what the system is actually doing right now.
 */
export type ExecStatus = "pending" | "active" | "done" | "error" | "skipped";

export type ExecStep = {
  id: string;
  label: string;
  status: ExecStatus;
  note?: string;
  startedAt?: number;
  endedAt?: number;
};

export type ExecStepInit = { id: string; label: string };

export function useExecutionLog() {
  const [steps, setSteps] = useState<ExecStep[]>([]);
  const [running, setRunning] = useState(false);
  const order = useRef(0);

  const patch = useCallback((id: string, next: Partial<ExecStep>, fallbackLabel?: string) => {
    setSteps((prev) => {
      const i = prev.findIndex((s) => s.id === id);
      if (i === -1) {
        return [...prev, { id, label: fallbackLabel || id, status: "pending", ...next } as ExecStep];
      }
      const copy = [...prev];
      copy[i] = { ...copy[i], ...next };
      return copy;
    });
  }, []);

  /** Reset the log and seed the known steps for this action. */
  const start = useCallback((init: ExecStepInit[]) => {
    order.current = 0;
    setRunning(true);
    setSteps(init.map((s) => ({ ...s, status: "pending" as ExecStatus })));
  }, []);

  /** Mark a step as in-flight. Auto-appends if it wasn't pre-declared. */
  const begin = useCallback((id: string, label?: string) => {
    setRunning(true);
    const next: Partial<ExecStep> = { status: "active", startedAt: Date.now() };
    if (label) next.label = label;
    patch(id, next, label);
  }, [patch]);


  const done = useCallback((id: string, note?: string) => {
    patch(id, { status: "done", endedAt: Date.now(), ...(note ? { note } : {}) });
  }, [patch]);

  const skip = useCallback((id: string, note?: string) => {
    patch(id, { status: "skipped", endedAt: Date.now(), ...(note ? { note } : {}) });
  }, [patch]);

  const fail = useCallback((id: string, note?: string) => {
    patch(id, { status: "error", endedAt: Date.now(), ...(note ? { note } : {}) });
    setRunning(false);
  }, [patch]);

  /** Attach live sub-detail to a step without changing its status. */
  const note = useCallback((id: string, text: string) => {
    patch(id, { note: text });
  }, [patch]);

  /** Append a step discovered at runtime (e.g. a tool the agent just chose). */
  const add = useCallback((step: ExecStep) => {
    setSteps((prev) => (prev.some((s) => s.id === step.id) ? prev : [...prev, step]));
  }, []);

  /** Finish the run: any step still active is closed out. */
  const finish = useCallback((finalLabel?: string) => {
    setSteps((prev) => {
      const closed = prev.map((s) =>
        s.status === "active" ? { ...s, status: "done" as ExecStatus, endedAt: Date.now() } : s,
      );
      return finalLabel
        ? [...closed, { id: `__done_${Date.now()}`, label: finalLabel, status: "done" as ExecStatus, endedAt: Date.now() }]
        : closed;
    });
    setRunning(false);
  }, []);

  const reset = useCallback(() => {
    setSteps([]);
    setRunning(false);
  }, []);

  /** Replace the whole list — used when steps are derived from server events. */
  const replace = useCallback((next: ExecStep[]) => setSteps(next), []);

  return { steps, running, start, begin, done, skip, fail, note, add, finish, reset, replace, setRunning };
}
