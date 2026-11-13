import { useEffect, useRef } from "react";
import { pollDelay } from "@/lib/poll";

/**
 * Refreshes a screen while something is open (docs/outer-control-polling.md).
 *  - one refresh at a time: the next is scheduled only after the last one ended, so a slow server is never piled on
 *  - slower when nothing is running (only waiting for a person), slower still after failures
 *  - nothing while the tab is hidden; one refresh right away when it comes back
 * `run` returns false (or throws) when the refresh failed.
 */
export function usePoller(run: () => Promise<boolean | void>, opts: { active: boolean; fast: boolean }): void {
  const runRef = useRef(run);
  const fastRef = useRef(opts.fast);
  runRef.current = run;
  fastRef.current = opts.fast;

  useEffect(() => {
    if (!opts.active) return;
    let stopped = false;
    let timer: ReturnType<typeof setTimeout> | null = null;
    let failures = 0;
    let running = false;
    const hidden = () => typeof document !== "undefined" && document.visibilityState === "hidden";

    const schedule = () => {
      if (stopped || hidden()) return; // a hidden tab asks for nothing; becoming visible restarts the loop
      timer = setTimeout(tick, pollDelay(fastRef.current, failures));
    };
    const tick = async () => {
      timer = null;
      if (stopped || running) return;
      if (hidden()) return;
      running = true;
      try {
        const ok = await runRef.current();
        failures = ok === false ? failures + 1 : 0;
      } catch {
        failures += 1;
      } finally {
        running = false;
      }
      schedule();
    };
    const onVisible = () => {
      if (stopped || hidden() || running) return;
      if (timer) { clearTimeout(timer); timer = null; }
      void tick();
    };

    schedule();
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      stopped = true;
      if (timer) clearTimeout(timer);
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, [opts.active]);
}
