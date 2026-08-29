// "Real precedent memory" plan, item 4: turns real, embedding-matched
// precedent into a prompt block for control-engine's AI-scored judgment
// -- the same idea as fit-learning.ts's own MEASURED FIT HISTORY block,
// applied here to genuine semantic precedent instead of a token-overlap
// heuristic, and scoped to one api key's own history rather than the
// whole account.
export type PrecedentPromptRow = {
  actionType: string;
  provider: string;
  similarity: number;
  decision: string;
  reasoning: string;
};

const MAX_PROMPT_ROWS = 6;

/** Pure -- builds the prompt text, or "" when there's nothing to show (never injects an empty/misleading section header). */
export function buildPrecedentPromptBlock(rows: PrecedentPromptRow[]): string {
  if (!rows.length) return "";
  const lines = rows
    .slice(0, MAX_PROMPT_ROWS)
    .map((r) => `- (${Math.round(r.similarity * 100)}% similar) ${r.decision} — ${r.reasoning.slice(0, 200)}`);
  return (
    `\n# REAL PRECEDENT (this API key's own most similar past decisions, found by real semantic search)\n` +
    `${lines.join("\n")}\n` +
    `This is genuine history for this exact integration, not a hypothetical -- weigh it accordingly in your ` +
    `intent/risk/fit judgment, but don't treat it as automatically decisive on its own.\n`
  );
}
