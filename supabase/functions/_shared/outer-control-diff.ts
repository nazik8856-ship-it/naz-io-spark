// Control Diff: what a tool sent next to what NazAI passed on, per reply. The tool's reply is kept as segments: plain text, a
// span a rule removed (stored only as its label and the rule's name, never the removed text), or a span a rule flagged (blocked
// or sent for approval; that text is kept, as it is in the stored reply too).

export type DiffSegment =
  | { t: string }
  | { removed: string; rule: string }
  | { flagged: string; rule: string; effect: "block" | "approval" };
export type ControlDiff = { segments: DiffSegment[]; removed: number; flagged: number; truncated: boolean };
/** A rule that acted on a reply: its pattern, and whether it removed its matches or blocked / asked for approval. */
export type DiffRule = { id: string; name: string; category: string; pattern: string | null; effect: "redact" | "block" | "approval" };

/** At most this much of a reply is kept in the diff (the stored reply itself is capped too). */
export const MAX_DIFF_CHARS = 8000;
const LABEL: Record<string, string> = { "builtin:secret_key": "API key", "builtin:card_number": "card number", "builtin:national_id": "ID number" };
/** What a removed span was, in plain words; the text itself is never kept. */
export const removedLabel = (r: DiffRule) => LABEL[r.id] ?? (r.category === "secrets" ? "secret" : r.category === "pii" ? "personal data" : "words");

type Span = { start: number; end: number; rule: DiffRule };

export function controlDiff(content: string, rules: DiffRule[]): ControlDiff {
  const spans: Span[] = [];
  const seen = new Set<string>();
  for (const r of rules) {
    if (!r.pattern || seen.has(r.id)) continue;
    seen.add(r.id);
    let re: RegExp;
    try { re = new RegExp(r.pattern, "gi"); } catch { continue; }
    for (const m of content.matchAll(re)) {
      if (!m[0]) break; // a pattern that matches nothing visible would loop on every character
      spans.push({ start: m.index!, end: m.index! + m[0].length, rule: r });
    }
  }
  // Earlier first; where spans overlap, a removal wins over a flag (a secret is never shown because a flag covered it too).
  spans.sort((a, b) => a.start - b.start || (a.rule.effect === "redact" ? -1 : 1));
  const kept: Span[] = [];
  for (const s of spans) {
    const last = kept[kept.length - 1];
    if (!last || s.start >= last.end) { kept.push(s); continue; }
    if (s.rule.effect === "redact" && last.rule.effect !== "redact") { last.rule = s.rule; }
    if (s.rule.effect === "redact" || last.rule.effect === "redact") last.end = Math.max(last.end, s.end);
  }
  const segments: DiffSegment[] = [];
  let at = 0, size = 0, truncated = false, removed = 0, flagged = 0;
  const pushText = (t: string) => {
    if (!t) return;
    const room = MAX_DIFF_CHARS - size;
    if (room <= 0) { truncated = true; return; }
    const piece = t.length > room ? t.slice(0, room) : t;
    if (piece.length < t.length) truncated = true;
    size += piece.length;
    const prev = segments[segments.length - 1];
    if (prev && "t" in prev) prev.t += piece; else segments.push({ t: piece });
  };
  for (const s of kept) {
    pushText(content.slice(at, s.start));
    if (size >= MAX_DIFF_CHARS) { truncated = true; break; }
    if (s.rule.effect === "redact") { segments.push({ removed: removedLabel(s.rule), rule: s.rule.name }); removed++; }
    else {
      const text = content.slice(s.start, s.end).slice(0, 200);
      size += text.length;
      segments.push({ flagged: text, rule: s.rule.name, effect: s.rule.effect === "approval" ? "approval" : "block" });
      flagged++;
    }
    at = s.end;
  }
  if (!truncated) pushText(content.slice(at));
  return { segments, removed, flagged, truncated };
}

/** The diff of one checked reply from the rules that acted on it; null when no rule removed or flagged anything in the text. */
export function diffForReply(content: string, rules: DiffRule[]): ControlDiff | null {
  const d = controlDiff(content, rules);
  return d.removed || d.flagged ? d : null;
}
