// Outer Control: one plain sentence saying what happened to an external AI's
// output. Works for rows written before the `changes` column existed.
export type OutcomeInput = {
  verdict: "allow" | "modify" | "block" | "escalate";
  content_kind: "text" | "action";
  changes: { count: number }[] | null;
  executed: boolean;
};

export function describeOutcome(r: OutcomeInput): string {
  const n = r.changes?.reduce((s, c) => s + c.count, 0) ?? 0;
  switch (r.verdict) {
    case "allow":
      return r.content_kind === "action"
        ? (r.executed ? "Allowed — the proposed action was carried out." : "Allowed — nothing in the proposed action broke a rule.")
        : "Allowed — the output was returned unchanged.";
    case "modify":
      if (r.content_kind === "action") return "Modified — a corrected version of the proposed action was returned.";
      return n > 0
        ? `Modified — ${n} ${n === 1 ? "piece" : "pieces"} of the output removed; the cleaned text was returned.`
        : "Modified — a cleaned version was returned.";
    case "escalate":
      return "Held — nothing was returned. A person needs to approve it first.";
    case "block":
      return r.content_kind === "action" ? "Blocked — the proposed action was not carried out." : "Blocked — nothing was returned to the caller.";
  }
}
