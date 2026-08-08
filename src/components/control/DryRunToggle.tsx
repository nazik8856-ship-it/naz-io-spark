import { useEffect, useRef, useState } from "react";
import { FlaskConical } from "lucide-react";

const REVEAL_CODE = "dryrun";
const REVEAL_KEY = "nazai_dryrun_reveal";
const STATE_KEY = "nazai_dryrun_on";

/**
 * DRY-RUN TOGGLE (hidden test control).
 * Stays out of the normal UI: it only appears after the operator types
 * "dryrun" on the page, or loads it with ?ops=dryrun. When on, control-engine
 * scores the action fully but never executes it for real.
 */
export default function DryRunToggle({ on, onChange }: { on: boolean; onChange: (v: boolean) => void }) {
  const [revealed, setRevealed] = useState(false);
  const buffer = useRef("");

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    if (params.get("ops") === REVEAL_CODE) sessionStorage.setItem(REVEAL_KEY, "1");
    if (sessionStorage.getItem(REVEAL_KEY) === "1") setRevealed(true);
    if (sessionStorage.getItem(STATE_KEY) === "1") onChange(true);

    const onKey = (e: KeyboardEvent) => {
      if (e.key.length !== 1) return;
      buffer.current = (buffer.current + e.key.toLowerCase()).slice(-REVEAL_CODE.length);
      if (buffer.current === REVEAL_CODE) {
        sessionStorage.setItem(REVEAL_KEY, "1");
        setRevealed(true);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  if (!revealed) return null;

  const toggle = () => {
    const next = !on;
    sessionStorage.setItem(STATE_KEY, next ? "1" : "0");
    onChange(next);
  };

  return (
    <div
      className="mx-6 mb-3 flex items-center gap-3 rounded-xl border px-4 py-3"
      style={{
        borderColor: on ? "#f59e0b88" : "#ffffff14",
        backgroundColor: on ? "#f59e0b0f" : "#ffffff06",
      }}
    >
      <FlaskConical className="h-4 w-4" style={{ color: on ? "#f59e0b" : "#71717a" }} />
      <div className="min-w-0 flex-1">
        <p className="text-xs font-mono uppercase tracking-wider" style={{ color: on ? "#f59e0b" : "#a1a1aa" }}>
          Dry run {on ? "on" : "off"}
        </p>
        <p className="text-[11px] text-zinc-500 truncate">
          {on
            ? "Actions are scored in full but never actually carried out."
            : "Approved actions run for real against connected apps."}
        </p>
      </div>
      <button
        onClick={toggle}
        aria-label="Toggle dry-run mode"
        className="inline-flex items-center gap-1.5 rounded-lg border px-3 py-1.5 text-xs font-semibold transition-colors"
        style={{ borderColor: on ? "#f59e0b88" : "#22c55e55", color: on ? "#f59e0b" : "#22c55e" }}
      >
        {on ? "Disable" : "Enable"}
      </button>
    </div>
  );
}
