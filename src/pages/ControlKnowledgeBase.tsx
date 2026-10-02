// Blueprint task #77: knowledge_base_entries (both human-authored and
// auto-drafted via knowledge-base-auto-draft-sweep) had NO frontend page
// anywhere -- a human-authored entry couldn't be reviewed or edited once
// saved, and an auto-drafted one (always inserted enabled=false,
// pending_review=true) was permanently invisible, since nothing ever
// flips `enabled` for it. This page is the first and only place either
// kind can be seen, confirmed, or removed -- mirrors ControlSafetyRules.tsx
// and HardRulesPanel.tsx's own add/promote/remove shape, since this table's
// scoping (action_type_pattern/provider, both optional) is the same as
// those two.
import { useCallback, useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { ArrowLeft, BookOpen, Plus, Trash2, Sparkles, CheckCircle2 } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
// Stale generated types: control-system tables aren't in types.ts yet.
const anyDb = supabase as any;
import { useAuth } from "@/hooks/useAuth";
import { useActiveAccount } from "@/hooks/useActiveAccount";
import { hasPermission } from "@/lib/account-switcher";
import { friendlyErrorMessage } from "@/lib/friendly-errors";
import { toast } from "@/hooks/use-toast";

type Entry = {
  id: string;
  entry_text: string;
  action_type_pattern: string | null;
  provider: string | null;
  enabled: boolean;
  pending_review: boolean;
  auto_drafted: boolean;
  created_at: string;
};

const SCOPES: { label: string; pattern: string | null }[] = [
  { label: "Any action", pattern: null },
  { label: "Sending email", pattern: "send_email" },
  { label: "Replying to email", pattern: "reply_email" },
  { label: "Posting to Slack", pattern: "slack_*" },
  { label: "Notion writes", pattern: "notion_*" },
  { label: "Canva writes", pattern: "canva_*" },
  { label: "Shopify writes", pattern: "shopify_*" },
  { label: "Figma writes", pattern: "figma_*" },
  { label: "Calendar events", pattern: "create_calendar_event" },
];

/**
 * KNOWLEDGE BASE — facts and standing instructions the AI actually reads
 * when judging a borderline decision (control-engine's own prompt
 * enrichment). Distinct from hard/safety rules: this never blocks or
 * auto-approves anything by itself, it only informs the model's judgment.
 */
export default function ControlKnowledgeBase() {
  const navigate = useNavigate();
  const { user } = useAuth();
  const { accountId, role, permissions } = useActiveAccount();
  const canWrite = hasPermission(role, permissions, "policy");
  const [entries, setEntries] = useState<Entry[]>([]);
  const [text, setText] = useState("");
  const [scope, setScope] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    if (!accountId) return;
    const { data } = await anyDb
      .from("knowledge_base_entries")
      .select("id, entry_text, action_type_pattern, provider, enabled, pending_review, auto_drafted, created_at")
      .eq("user_id", accountId)
      .order("created_at", { ascending: false });
    setEntries((data ?? []) as Entry[]);
  }, [accountId]);

  useEffect(() => { void load(); }, [load]);

  const add = async () => {
    if (!user || !canWrite || !text.trim() || busy) return;
    setBusy(true);
    const { error } = await anyDb.from("knowledge_base_entries").insert({
      user_id: accountId,
      entry_text: text.trim(),
      action_type_pattern: scope,
      enabled: true,
      pending_review: false,
      auto_drafted: false,
    });
    setBusy(false);
    if (error) {
      toast({ title: "Could not save entry", description: friendlyErrorMessage(error.message), variant: "destructive" });
      return;
    }
    setText("");
    toast({ title: "Entry saved", description: "The AI will read it when judging a matching action." });
    void load();
  };

  const confirm = async (e: Entry) => {
    if (!canWrite) return;
    const { error } = await anyDb
      .from("knowledge_base_entries")
      .update({ enabled: true, pending_review: false })
      .eq("id", e.id);
    if (error) {
      toast({ title: "Could not enable entry", description: friendlyErrorMessage(error.message), variant: "destructive" });
      return;
    }
    toast({ title: "Entry enabled", description: "It will now be read when judging matching actions." });
    void load();
  };

  const toggle = async (e: Entry) => {
    if (!canWrite) return;
    const { error } = await anyDb.from("knowledge_base_entries").update({ enabled: !e.enabled }).eq("id", e.id);
    if (error) {
      toast({ title: "Couldn't update entry", description: friendlyErrorMessage(error.message), variant: "destructive" });
      return;
    }
    void load();
  };

  const remove = async (e: Entry) => {
    if (!canWrite) return;
    const { error } = await anyDb.from("knowledge_base_entries").delete().eq("id", e.id);
    if (error) {
      toast({ title: "Could not remove entry", description: friendlyErrorMessage(error.message), variant: "destructive" });
      return;
    }
    void load();
  };

  const pending = entries.filter((e) => e.pending_review);
  const reviewed = entries.filter((e) => !e.pending_review);

  return (
    <div className="min-h-screen w-full text-white" style={{ backgroundColor: "#020617" }}>
      <header className="flex items-center gap-3 border-b border-white/5 px-6 py-4">
        <button
          onClick={() => navigate("/control-system")}
          className="flex items-center gap-2 text-zinc-400 transition-colors hover:text-white"
          aria-label="Back to Control System"
        >
          <ArrowLeft className="h-5 w-5" />
          <span className="font-mono text-sm uppercase tracking-wider">Control System</span>
        </button>
      </header>

      <main className="mx-auto w-full max-w-3xl px-6 py-8">
        <h1 className="flex items-center gap-2 text-xl font-semibold">
          <BookOpen className="h-5 w-5 text-cyan-300" /> Knowledge base
        </h1>
        <p className="mt-1 text-sm text-zinc-400">
          Facts and standing instructions the AI reads when judging a borderline decision — e.g.
          "our refund policy is 30 days" or "'VIP' means a customer on our Enterprise plan." Never
          blocks or approves anything by itself; it only informs the model's judgment.
        </p>

        {pending.length > 0 && (
          <section className="mt-6 space-y-2">
            <h2 className="flex items-center gap-1.5 font-mono text-xs uppercase tracking-wider text-amber-400">
              <Sparkles className="h-3.5 w-3.5" /> Auto-drafted — needs your review
            </h2>
            {pending.map((e) => (
              <div key={e.id} className="rounded-lg border border-amber-500/25 bg-amber-500/[0.04] p-3">
                <p className="text-sm text-zinc-200">{e.entry_text}</p>
                <p className="mt-1 font-mono text-[11px] text-zinc-500">
                  {SCOPES.find((s) => s.pattern === e.action_type_pattern)?.label ?? e.action_type_pattern ?? "Any action"}
                  {e.provider ? ` · ${e.provider}` : ""}
                </p>
                {canWrite && (
                  <div className="mt-2 flex gap-2">
                    <button
                      onClick={() => confirm(e)}
                      className="inline-flex items-center gap-1.5 rounded-lg border border-emerald-500/40 px-2.5 py-1 text-[11px] font-semibold text-emerald-400"
                    >
                      <CheckCircle2 className="h-3 w-3" /> Enable as-is
                    </button>
                    <button
                      onClick={() => remove(e)}
                      className="inline-flex items-center gap-1.5 rounded-lg border border-white/10 px-2.5 py-1 text-[11px] text-zinc-400 hover:text-rose-300"
                    >
                      <Trash2 className="h-3 w-3" /> Discard
                    </button>
                  </div>
                )}
              </div>
            ))}
          </section>
        )}

        {canWrite ? (
          <section className="mt-6 rounded-lg border border-white/10 bg-white/[0.03] p-4">
            <h2 className="font-mono text-xs uppercase tracking-wider text-zinc-400">Add an entry</h2>
            <div className="mt-3 space-y-2">
              <input
                value={text}
                onChange={(e) => setText(e.target.value)}
                onKeyDown={(e) => { if (e.key === "Enter") void add(); }}
                placeholder="e.g. our refund policy is 30 days"
                aria-label="Knowledge-base entry"
                className="w-full rounded border border-white/10 bg-black/40 px-3 py-2 text-sm outline-none focus:border-cyan-500/50"
              />
              <div className="flex flex-wrap items-center gap-2">
                <select
                  value={scope ?? ""}
                  onChange={(e) => setScope(e.target.value || null)}
                  aria-label="Applies to"
                  className="rounded border border-white/10 bg-black/40 px-3 py-2 text-xs outline-none"
                >
                  {SCOPES.map((s) => (
                    <option key={s.label} value={s.pattern ?? ""}>{s.label}</option>
                  ))}
                </select>
                <button
                  disabled={busy || !text.trim()}
                  onClick={add}
                  className="flex items-center gap-1 rounded border border-cyan-500/40 bg-cyan-500/10 px-3 py-2 text-xs font-mono uppercase text-cyan-300 hover:bg-cyan-500/20 disabled:opacity-50"
                >
                  <Plus className="h-3.5 w-3.5" /> Add
                </button>
              </div>
            </div>
          </section>
        ) : (
          <p className="mt-6 text-[11px] text-amber-300/80">
            You have view-only access to this account's knowledge base — only the account owner or a team owner can add, enable, or remove entries.
          </p>
        )}

        <section className="mt-6 space-y-2">
          <h2 className="font-mono text-xs uppercase tracking-wider text-zinc-400">
            Entries{reviewed.length ? ` · ${reviewed.length}` : ""}
          </h2>
          {reviewed.length === 0 ? (
            <p className="rounded-lg border border-white/10 bg-white/[0.02] p-4 text-sm text-zinc-500">
              No entries yet.
            </p>
          ) : reviewed.map((e) => (
            <div key={e.id} className="rounded-lg border border-white/10 bg-white/[0.03] p-3">
              <div className="flex items-start gap-3">
                <div className="min-w-0 flex-1">
                  <p className="text-sm text-zinc-200">{e.entry_text}</p>
                  <p className="mt-1 font-mono text-[11px] text-zinc-500">
                    {SCOPES.find((s) => s.pattern === e.action_type_pattern)?.label ?? e.action_type_pattern ?? "Any action"}
                    {e.provider ? ` · ${e.provider}` : ""}
                    {e.auto_drafted ? " · auto-drafted" : ""}
                  </p>
                </div>
                {canWrite && (
                  <>
                    <button onClick={() => toggle(e)} className="text-[10px] font-mono uppercase text-zinc-400 hover:text-white">
                      {e.enabled ? "on" : "off"}
                    </button>
                    <button onClick={() => remove(e)} className="text-zinc-500 hover:text-rose-300" aria-label="Delete entry">
                      <Trash2 className="h-4 w-4" />
                    </button>
                  </>
                )}
              </div>
            </div>
          ))}
        </section>
      </main>
    </div>
  );
}
