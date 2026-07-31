import { useEffect, useRef, useState } from "react";
import { Loader2, Upload, Send, Clock, MessageCircleQuestion, FileCheck2 } from "lucide-react";
import { toast } from "sonner";
import {
  submitClarificationAnswer,
  uploadClarificationFile,
  type ClarificationRequest,
} from "@/lib/agent-clarifications";

/**
 * The real interactive widget for an `ask_user` pause.
 *
 * It renders whatever the ask actually needs — a file upload box, choice
 * buttons, or a text field — the moment the runtime logs the request, and
 * after the response window elapses it turns into a persistent
 * "Waiting for your input" notice instead of looking like it's processing.
 */
export default function AskUserPrompt({
  request,
  onAnswered,
}: {
  request: ClarificationRequest;
  onAnswered?: () => void;
}) {
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const [file, setFile] = useState<File | null>(null);
  const [elapsed, setElapsed] = useState(Date.now() - request.createdAt);
  const fileRef = useRef<HTMLInputElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    inputRef.current?.focus();
  }, [request.id]);

  useEffect(() => {
    const iv = setInterval(() => setElapsed(Date.now() - request.createdAt), 1000);
    return () => clearInterval(iv);
  }, [request.createdAt]);

  const timedOut = elapsed > request.timeoutMs;

  const send = async (answer: string, uploaded?: { url: string; name: string }) => {
    if (busy) return;
    setBusy(true);
    try {
      await submitClarificationAnswer({
        agentId: request.agentId,
        request,
        answer,
        fileUrl: uploaded?.url,
        fileName: uploaded?.name,
      });
      toast.success("Sent — the agent is resuming");
      setText("");
      setFile(null);
      onAnswered?.();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Couldn't send your answer");
    } finally {
      setBusy(false);
    }
  };

  const sendFile = async () => {
    if (!file || busy) return;
    setBusy(true);
    try {
      const url = await uploadClarificationFile(request.agentId, file);
      await submitClarificationAnswer({
        agentId: request.agentId,
        request,
        answer: text.trim() || `Uploaded ${file.name}`,
        fileUrl: url,
        fileName: file.name,
      });
      toast.success("File uploaded — the agent is resuming");
      setFile(null);
      setText("");
      onAnswered?.();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Upload failed");
    } finally {
      setBusy(false);
    }
  };

  const mins = Math.floor(elapsed / 60000);

  return (
    <div
      className="rounded-2xl p-4 border"
      style={{
        borderColor: timedOut ? "rgba(251,191,36,0.4)" : "rgba(34,211,238,0.32)",
        background: timedOut ? "rgba(251,191,36,0.06)" : "rgba(34,211,238,0.05)",
      }}
    >
      <div className="flex items-start gap-2.5">
        <MessageCircleQuestion className={`h-4 w-4 mt-0.5 shrink-0 ${timedOut ? "text-amber-300" : "text-cyan-300"}`} />
        <div className="min-w-0 flex-1">
          <div className={`text-[10px] uppercase tracking-[0.2em] font-mono mb-1 ${timedOut ? "text-amber-300" : "text-cyan-300"}`}>
            {timedOut ? "Waiting for your input" : "The agent needs you"}
          </div>
          <div className="text-sm text-white leading-relaxed">{request.question}</div>

          {request.inputType === "choice" && request.options.length > 0 && (
            <div className="flex flex-wrap gap-2 mt-3">
              {request.options.map((o) => (
                <button
                  key={o}
                  disabled={busy}
                  onClick={() => send(o)}
                  className="px-3 py-1.5 text-xs rounded-lg border border-cyan-300/30 bg-cyan-300/10 text-cyan-100 hover:bg-cyan-300/20 disabled:opacity-50"
                >
                  {o}
                </button>
              ))}
            </div>
          )}

          {request.inputType === "file" && (
            <div className="mt-3 space-y-2">
              <input
                ref={fileRef}
                type="file"
                accept={request.accept}
                className="hidden"
                onChange={(e) => setFile(e.target.files?.[0] || null)}
              />
              <button
                type="button"
                disabled={busy}
                onClick={() => fileRef.current?.click()}
                className="w-full flex items-center justify-center gap-2 px-4 py-6 rounded-xl border border-dashed border-cyan-300/35 bg-black/25 text-xs text-cyan-100 hover:bg-cyan-300/10 disabled:opacity-50"
              >
                {file ? <FileCheck2 className="h-4 w-4" /> : <Upload className="h-4 w-4" />}
                {file ? file.name : `Choose a file to upload${request.accept ? ` (${request.accept})` : ""}`}
              </button>
              <div className="flex items-center gap-2">
                <input
                  value={text}
                  onChange={(e) => setText(e.target.value)}
                  placeholder="Add a note (optional)"
                  className="flex-1 px-3 py-2 text-xs rounded-lg border border-white/10 bg-black/30 text-white focus:outline-none focus:border-cyan-400/60"
                />
                <button
                  onClick={sendFile}
                  disabled={busy || !file}
                  className="inline-flex items-center gap-1.5 px-3 py-2 rounded-lg bg-cyan-400 text-black text-xs font-bold hover:opacity-90 disabled:opacity-40"
                >
                  {busy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Upload className="h-3.5 w-3.5" />}
                  Upload
                </button>
              </div>
            </div>
          )}

          {request.inputType !== "file" && (
            <form
              className="flex items-center gap-2 mt-3"
              onSubmit={(e) => {
                e.preventDefault();
                if (text.trim()) send(text.trim());
              }}
            >
              <input
                ref={inputRef}
                value={text}
                onChange={(e) => setText(e.target.value)}
                placeholder={request.inputType === "choice" ? "or type your own answer" : "Type your answer"}
                className="flex-1 px-3 py-2 text-xs rounded-lg border border-white/10 bg-black/30 text-white focus:outline-none focus:border-cyan-400/60"
              />
              <button
                type="submit"
                disabled={busy || !text.trim()}
                className="inline-flex items-center gap-1.5 px-3 py-2 rounded-lg bg-cyan-400 text-black text-xs font-bold hover:opacity-90 disabled:opacity-40"
              >
                {busy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Send className="h-3.5 w-3.5" />}
                Send
              </button>
            </form>
          )}

          <div className="flex items-center gap-1.5 mt-2 text-[10px] font-mono text-zinc-500">
            <Clock className="h-3 w-3" />
            {timedOut
              ? `Paused — nothing is running. Waiting ${mins} min for your reply.`
              : `Asked ${mins > 0 ? `${mins} min ago` : "just now"} — the run is paused until you reply.`}
          </div>
        </div>
      </div>
    </div>
  );
}
