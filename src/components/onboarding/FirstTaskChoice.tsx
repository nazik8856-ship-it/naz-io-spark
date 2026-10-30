import { ArrowRight, Clock, Plug, Sparkles } from "lucide-react";
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "@/components/ui/dialog";

// First-value onboarding, step 2 (after "Start now"): how the first controlled task runs. NazAI can run it with its own AI
// models (no setup), or the person connects the AI they already use.

export default function FirstTaskChoice({ open, onNazai, onManual, onClose }: { open: boolean; onNazai: () => void; onManual: () => void; onClose: () => void }) {
  return (
    <Dialog open={open} onOpenChange={(o) => { if (!o) onClose(); }}>
      <DialogContent
        className="w-[calc(100%-2rem)] max-w-2xl gap-0 overflow-hidden border-cyan-400/25 bg-[#030a17] p-0 text-white shadow-[0_0_90px_-20px_rgba(34,211,238,0.45)] sm:rounded-2xl"
        data-testid="first-task-choice"
      >
        <div className="pointer-events-none absolute -left-24 -top-24 h-64 w-64 rounded-full bg-cyan-500/15 blur-[90px] oc-glow" aria-hidden />
        <div className="pointer-events-none absolute -right-24 bottom-0 h-56 w-56 rounded-full bg-amber-400/10 blur-[90px] oc-glow" aria-hidden />

        <div className="relative px-5 pb-2 pt-7 text-center sm:px-8">
          <div className="mx-auto mb-3 inline-flex items-center gap-1.5 rounded-full border border-cyan-400/30 bg-cyan-400/[0.08] px-3 py-1 font-mono text-[10px] uppercase tracking-[0.2em] text-cyan-200">
            Step 1 of 2 · Your first task
          </div>
          <DialogTitle className="text-2xl font-bold tracking-tight">Who should run your first task?</DialogTitle>
          <DialogDescription className="mx-auto mt-2 max-w-md text-sm leading-relaxed text-zinc-400">
            Either way, every AI reply is checked against your rules before you see it.
          </DialogDescription>
        </div>

        <div className="relative grid gap-3 px-5 pb-6 pt-5 sm:grid-cols-2 sm:px-8 sm:pb-8">
          <button
            type="button"
            onClick={onNazai}
            autoFocus
            className="oc-in group relative flex flex-col rounded-2xl border border-cyan-400/50 bg-gradient-to-br from-cyan-500/[0.14] via-[#061527] to-emerald-400/[0.06] p-5 text-left shadow-[0_0_32px_-10px_rgba(34,211,238,0.7)] transition hover:border-cyan-300 hover:shadow-[0_0_44px_-8px_rgba(34,211,238,0.85)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cyan-200"
            data-testid="first-task-nazai"
          >
            <span className="absolute right-3 top-3 rounded-full border border-emerald-300/50 bg-emerald-400/10 px-2 py-0.5 font-mono text-[9.5px] uppercase tracking-[0.14em] text-emerald-200">Recommended</span>
            <span className="flex h-10 w-10 items-center justify-center rounded-xl border border-cyan-300/50 bg-cyan-400/15 shadow-[0_0_20px_-4px_rgba(34,211,238,0.7)]">
              <Sparkles className="h-5 w-5 text-cyan-100" />
            </span>
            <span className="mt-4 text-lg font-semibold">NazAI does it for me</span>
            <span className="mt-1.5 text-sm leading-relaxed text-zinc-300">NazAI asks its own AI models for you, checks every answer and gives you one clean result.</span>
            <span className="mt-4 flex flex-wrap gap-x-4 gap-y-1 text-xs text-cyan-200/90">
              <span className="inline-flex items-center gap-1"><Clock className="h-3.5 w-3.5" /> Ready in about a minute</span>
              <span>No setup · free for your first 2 tasks</span>
            </span>
            <span className="mt-5 inline-flex items-center gap-1.5 text-sm font-semibold text-cyan-200 transition-all group-hover:gap-2.5">Let NazAI do it <ArrowRight className="h-4 w-4" /></span>
          </button>

          <button
            type="button"
            onClick={onManual}
            className="oc-in group flex flex-col rounded-2xl border border-white/10 bg-white/[0.03] p-5 text-left transition hover:border-amber-300/50 hover:bg-amber-400/[0.05] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-amber-200"
            style={{ animationDelay: "0.08s" }}
            data-testid="first-task-manual"
          >
            <span className="flex h-10 w-10 items-center justify-center rounded-xl border border-amber-300/40 bg-amber-400/10">
              <Plug className="h-5 w-5 text-amber-200" />
            </span>
            <span className="mt-4 text-lg font-semibold">I'll connect my own AI</span>
            <span className="mt-1.5 text-sm leading-relaxed text-zinc-400">Connect ChatGPT, Claude or any AI you already use with its key. NazAI checks its replies.</span>
            <span className="mt-4 flex flex-wrap gap-x-4 gap-y-1 text-xs text-zinc-500">
              <span className="inline-flex items-center gap-1"><Clock className="h-3.5 w-3.5" /> About 2 minutes to set up</span>
            </span>
            <span className="mt-5 inline-flex items-center gap-1.5 text-sm font-semibold text-amber-200/90 transition-all group-hover:gap-2.5">Set it up myself <ArrowRight className="h-4 w-4" /></span>
          </button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
