import { supabase } from "@/integrations/supabase/client";

/**
 * Shared handling for `ask_user` pauses.
 *
 * The runtime logs a `clarification_request` event describing exactly what it
 * needs from the human (free text, a choice, or a file upload). The UI must
 * render a real interactive control for it — never a spinner — and answering
 * resumes the run.
 */
export type ClarificationInputType = "text" | "choice" | "file";

export type ClarificationRequest = {
  id: string;
  agentId: string;
  question: string;
  options: string[];
  inputType: ClarificationInputType;
  accept?: string;
  runId: string;
  createdAt: number;
  timeoutMs: number;
};

type EventLike = {
  id: string;
  run_id?: string;
  kind: string;
  created_at: string;
  payload: Record<string, unknown> | null;
};

const DEFAULT_TIMEOUT_MS = 180_000;

/** The newest unanswered ask_user request in an event stream, if any. */
export function pendingClarification(events: EventLike[], agentId: string): ClarificationRequest | null {
  const requests = events.filter((e) => e.kind === "clarification_request");
  for (let i = requests.length - 1; i >= 0; i--) {
    const e = requests[i];
    const answered = events.some(
      (x) =>
        x.kind === "clarification_answer" &&
        (x.payload as { ref?: string } | null)?.ref === e.id,
    );
    if (answered) continue;
    const p = (e.payload || {}) as Record<string, unknown>;
    const options = Array.isArray(p.options) ? (p.options as string[]).filter(Boolean) : [];
    const raw = typeof p.input_type === "string" ? p.input_type : "";
    const inputType: ClarificationInputType =
      raw === "file" || raw === "choice" || raw === "text"
        ? (raw as ClarificationInputType)
        : options.length
          ? "choice"
          : "text";
    return {
      id: e.id,
      agentId,
      question: String(p.question || p.humanMessage || "The agent needs your input."),
      options,
      inputType,
      accept: typeof p.accept === "string" ? p.accept : undefined,
      runId: e.run_id || "",
      createdAt: new Date(e.created_at).getTime(),
      timeoutMs: typeof p.response_timeout_ms === "number" ? p.response_timeout_ms : DEFAULT_TIMEOUT_MS,
    };
  }
  return null;
}

/** Upload an operator-supplied file and return its public URL. */
export async function uploadClarificationFile(agentId: string, file: File): Promise<string> {
  const { data: auth } = await supabase.auth.getUser();
  const uid = auth.user?.id || "anon";
  const safe = file.name.replace(/[^a-zA-Z0-9._-]/g, "_");
  const path = `${uid}/clarifications/${agentId}/${Date.now()}-${safe}`;
  const { error } = await supabase.storage.from("mission-assets").upload(path, file, { upsert: true });
  if (error) throw error;
  const { data } = supabase.storage.from("mission-assets").getPublicUrl(path);
  return data.publicUrl;
}

/**
 * Persist the human answer, remember it so the agent never asks again, resolve
 * the matching blocker row, and resume the run.
 */
export async function submitClarificationAnswer(opts: {
  agentId: string;
  request: ClarificationRequest;
  answer: string;
  fileUrl?: string;
  fileName?: string;
}): Promise<void> {
  const { agentId, request } = opts;
  const answerText = [opts.answer, opts.fileUrl ? `File uploaded: ${opts.fileName || "file"} — ${opts.fileUrl}` : ""]
    .filter(Boolean)
    .join(" ")
    .trim();
  if (!answerText) return;

  const { data: auth } = await supabase.auth.getUser();
  const userId = auth.user?.id;

  if (userId) {
    await supabase.from("agent_events").insert({
      agent_id: agentId,
      user_id: userId,
      run_id: request.runId || crypto.randomUUID(),
      kind: "clarification_answer",
      payload: { ref: request.id, answer: answerText, file_url: opts.fileUrl ?? null },
    });
  }

  if (userId) {
    await supabase.from("agent_memory").insert({
      agent_id: agentId,
      user_id: userId,
      key: `operator.answer.${Date.now()}`,
      value: answerText.slice(0, 600),
      source: "operator",
    });
    // Clear the persisted "needs input" blocker and store the answer so the
    // question is never asked a second time.
    await supabase
      .from("integration_issues")
      .update({
        status: "resolved",
        resolved_at: new Date().toISOString(),
        resolution: { question: request.question, answer: answerText, answered_at: new Date().toISOString() },
      })
      .eq("user_id", userId)
      .eq("tool_kind", "ask_user")
      .eq("status", "open")
      .eq("title", request.question.slice(0, 180));
  }

  await supabase.functions.invoke("agent-runtime", {
    body: {
      agentId,
      trigger: "manual",
      userInstruction: `Operator answered "${request.question}": ${answerText}. Continue from where you paused.`,
    },
  });
}
