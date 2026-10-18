// Outer Control (active): the structured request sent to an external tool, and
// the contract its reply is read against. Pure, so every format is snapshot-tested.
//
// A request always carries: the objective, the (already masked) context, the
// rules the reply will be checked against and what a match does, the reply
// contract, and the session/step identifiers. Later steps also carry what was
// accepted before and, after a rejection, which rules the previous reply broke.

export type ToolFormat = "openai_chat" | "anthropic_messages" | "generic_json";

/** A rule as shown to the tool: its name and what a match does to the reply. */
export type RuleLine = { name: string; action: "block" | "approval" | "remove_text"; /** Already triggered by an earlier reply in this run. */ matchedBefore?: boolean };

export type AcceptedAnswer = { step: number; text: string };

export type ToolRequestInput = {
  format: ToolFormat;
  model?: string | null;
  objective: string;
  /** Must already have secrets masked by the caller. */
  context?: string | null;
  rules: RuleLine[];
  history: AcceptedAnswer[];
  /** Why the previous reply was rejected (rule names only, never the offending text). */
  correction?: string | null;
  /** A human's answer to the tool's last question (already masked). */
  answer?: string | null;
  sessionId: string;
  step: number;
  /** Decisions already made in this run (one line each) the tool must stay consistent with. */
  memory?: string[];
  /** Names of rules earlier replies in this run already triggered. */
  avoid?: string[];
  /** How many lower-priority rules were left out of `rules` (they are still enforced). */
  omittedRules?: number;
  /** Extra limits on this reply, added when the request was tightened after repeated rule violations. */
  constraints?: string[];
};

export const RESPONSE_CONTRACT =
  'Reply with JSON only: {"status": "done" | "continue" | "need_info", "answer": "<your reply>", "question": "<only when status is need_info>"}. ' +
  'Use "done" when the objective is met, "continue" when you need another round, and "need_info" only when you cannot proceed without information from a person. ' +
  'When the work produced something that can be opened (a document, an event, a page), add its https address as "links": [{"url": "<https address>", "label": "<what it is>"}].';

const ACTION_TEXT: Record<RuleLine["action"], string> = {
  block: "the reply is rejected",
  approval: "a person must approve the reply before it is used",
  remove_text: "the matching text is removed from the reply",
};

export function renderRules(rules: RuleLine[], omitted = 0): string {
  if (!rules.length) return "No account-specific rules apply beyond the built-in checks (secrets, card numbers, destructive wording).";
  const lines = rules.map((r) => `- ${r.name}: if matched, ${ACTION_TEXT[r.action]}${r.matchedBefore ? " (an earlier reply in this run already triggered this)" : ""}.`);
  if (omitted > 0) lines.push(`- ${omitted} further rule(s) also apply; every reply is checked against all of them.`);
  return lines.join("\n");
}

/** The instruction text shared by every format. */
export function buildInstruction(i: ToolRequestInput): string {
  const parts: string[] = [
    "You are being driven by NazAI Outer Control. Every reply you send is checked automatically against the rules below.",
    `Objective: ${i.objective}`,
  ];
  if (i.context && i.context.trim()) parts.push(`Context:\n${i.context.trim()}`);
  parts.push(`Rules your reply is checked against:\n${renderRules(i.rules, i.omittedRules ?? 0)}`);
  if (i.constraints && i.constraints.length) parts.push(`Constraints for this reply:\n${i.constraints.map((c) => `- ${c}`).join("\n")}`);
  if (i.memory && i.memory.length) parts.push(`Decisions already made in this run (stay consistent with them):\n${i.memory.map((m) => `- ${m}`).join("\n")}`);
  if (i.avoid && i.avoid.length) parts.push(`Earlier replies in this run already triggered these rules, so avoid them: ${i.avoid.join("; ")}.`);
  if (i.history.length) {
    parts.push(`Accepted so far:\n${i.history.map((h) => `Step ${h.step}: ${h.text}`).join("\n")}`);
  }
  if (i.answer && i.answer.trim()) parts.push(`A person answered your last question: ${i.answer.trim()}`);
  if (i.correction && i.correction.trim()) {
    const c = i.correction.trim();
    // A correction that already starts "Your previous reply ..." is a full sentence (empty or cut-off replies).
    parts.push(/^Your previous reply/.test(c) ? c : `Your previous reply was rejected. ${c} Reply again without it.`);
  }
  parts.push(`This is step ${i.step}. ${RESPONSE_CONTRACT}`);
  return parts.join("\n\n");
}

export function buildToolRequest(i: ToolRequestInput): { body: Record<string, unknown>; headers: Record<string, string> } {
  const instruction = buildInstruction(i);
  const headers = { "X-NazAI-Session": i.sessionId, "X-NazAI-Step": String(i.step) };
  if (i.format === "openai_chat") {
    return {
      headers,
      body: {
        model: i.model || "gpt-4o-mini",
        messages: [
          { role: "system", content: "Follow the instruction exactly and reply in the requested JSON shape." },
          { role: "user", content: instruction },
        ],
      },
    };
  }
  if (i.format === "anthropic_messages") {
    return {
      headers,
      body: {
        model: i.model || "claude-haiku-4-5",
        max_tokens: 1024,
        system: "Follow the instruction exactly and reply in the requested JSON shape.",
        messages: [{ role: "user", content: instruction }],
      },
    };
  }
  return {
    headers,
    body: {
      session_id: i.sessionId,
      step: i.step,
      objective: i.objective,
      context: i.context ?? null,
      rules: i.rules,
      accepted: i.history,
      correction: i.correction ?? null,
      answer: i.answer ?? null,
      memory: i.memory ?? [],
      avoid: i.avoid ?? [],
      constraints: i.constraints ?? [],
      response_contract: RESPONSE_CONTRACT,
      instruction,
    },
  };
}

export type ToolReply = {
  status: "done" | "continue" | "need_info";
  answer: string;
  question: string | null;
  /** False when the tool replied in plain text instead of the JSON contract. */
  structured: boolean;
};

const STATUSES = new Set(["done", "continue", "need_info"]);

/** Reads the reply text against the contract; plain text is accepted as a finished single reply. */
export function parseToolReply(text: string): ToolReply {
  const trimmed = text.trim();
  const unfenced = trimmed.replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/, "");
  if (unfenced.startsWith("{")) {
    try {
      const o = JSON.parse(unfenced) as Record<string, unknown>;
      if (o && typeof o === "object" && typeof o.status === "string" && STATUSES.has(o.status)) {
        let answer = typeof o.answer === "string" ? o.answer : "";
        // Links the tool reports travel inside the answer, so the rules check them and the artifact records them.
        const linkLines = Array.isArray(o.links) ? (o.links as unknown[]).flatMap((l) => {
          const x = (l && typeof l === "object" ? l : {}) as { url?: unknown; label?: unknown };
          const url = typeof x.url === "string" ? x.url.trim() : "";
          return /^https?:\/\/\S+$/i.test(url) && !answer.includes(url) ? [`- ${typeof x.label === "string" && x.label.trim() ? x.label.trim().slice(0, 80) : "Link"}: ${url}`] : [];
        }).slice(0, 5) : [];
        if (linkLines.length && o.status !== "need_info") answer = `${answer.trimEnd()}\n\nLinks:\n${linkLines.join("\n")}`.trim();
        const question = typeof o.question === "string" && o.question.trim() ? o.question.trim() : null;
        if (o.status === "need_info") {
          return { status: "need_info", answer, question: question ?? (answer.trim() || null), structured: true };
        }
        return { status: o.status as "done" | "continue", answer: answer || trimmed, question: null, structured: true };
      }
    } catch { /* not JSON after all: fall through to plain text */ }
  }
  return { status: "done", answer: trimmed, question: null, structured: false };
}
