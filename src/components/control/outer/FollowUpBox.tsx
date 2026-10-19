// Outer Control: a follow-up to a finished session. The request goes to the same tool with the controlled answer as context,
// and runs as a new session under the same rules. Only a completed session offers it.
import { useState } from "react";
import { MessageSquarePlus } from "lucide-react";

export default function FollowUpBox({ toolName, busy, onSend }: {
  toolName: string; busy: boolean;
  /** Starts the follow-up; resolves true when it was started. */
  onSend: (instruction: string) => Promise<boolean>;
}) {
  const [text, setText] = useState("");
  const ready = text.trim().length > 0 && text.trim().length <= 2000;
  return (
    <div className="rounded border border-cyan-300/20 bg-cyan-400/[0.04] p-2.5" data-testid="follow-up">
      <div className="flex items-center gap-1.5 font-mono text-[10px] uppercase tracking-wider text-cyan-300/80"><MessageSquarePlus className="h-3 w-3" /> Ask a follow-up</div>
      <textarea
        value={text} onChange={(e) => setText(e.target.value)} rows={2} maxLength={2000} aria-label="Follow-up request"
        placeholder={`A next request to ${toolName}, based on this answer…`}
        className="mt-1.5 w-full resize-y rounded-md border border-white/10 bg-black/30 px-2 py-1.5 text-xs text-zinc-100 placeholder:text-zinc-600 focus:border-cyan-300/50 focus:outline-none"
      />
      <div className="mt-1.5 flex flex-wrap items-center justify-between gap-2">
        <p className="min-w-[180px] flex-1 text-[10px] leading-snug text-zinc-500">Sent to {toolName} with this controlled answer as context. It starts a new session and goes through the same rules.</p>
        <button
          disabled={busy || !ready}
          onClick={async () => { if (await onSend(text.trim())) setText(""); }}
          data-testid="follow-up-send"
          className="rounded-md border border-cyan-300/50 bg-cyan-400/10 px-3 py-1 text-xs font-medium text-cyan-100 hover:bg-cyan-400/20 disabled:opacity-40"
        >
          {busy ? "Sending…" : "Send follow-up"}
        </button>
      </div>
    </div>
  );
}
