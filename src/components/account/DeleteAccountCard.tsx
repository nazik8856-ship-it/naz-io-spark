import { useCallback, useEffect, useState } from "react";
import { Loader2, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { ERASE_CONFIRM_WORD, ERASE_KEEPS, ERASE_REMOVES, canRequestErasure, daysUntil, erasureErrorText } from "@/lib/account-erasure";

// The generated types do not know this column yet.
const anyDb = supabase as any;

type Request = { id: string; execute_at: string };

/** Account settings: delete the whole account. 7 days to change your mind; nothing happens before that. */
export const DeleteAccountCard = () => {
  const { user } = useAuth();
  const [pending, setPending] = useState<Request | null | undefined>(undefined);
  const [open, setOpen] = useState(false);
  const [typed, setTyped] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!user) return;
    const { data, error: loadError } = await anyDb
      .from("data_deletion_requests")
      .select("id, execute_at")
      .eq("user_id", user.id)
      .eq("scope", "account")
      .eq("status", "pending")
      .maybeSingle();
    setPending(loadError ? null : ((data as Request | null) ?? null));
  }, [user]);

  useEffect(() => { void load(); }, [load]);

  const request = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!canRequestErasure(typed) || busy) return;
    setBusy(true);
    setError(null);
    try {
      const { error: rpcError } = await anyDb.rpc("request_account_erasure");
      if (rpcError) {
        setError(erasureErrorText(rpcError.message));
        return;
      }
      setOpen(false);
      setTyped("");
      toast.success("Account deletion scheduled", { description: "It runs in 7 days. You can cancel it here until then." });
      await load();
    } finally {
      setBusy(false);
    }
  };

  const cancel = async () => {
    if (!pending || busy) return;
    setBusy(true);
    setError(null);
    try {
      const { error: rpcError } = await anyDb.rpc("cancel_data_deletion", { _request_id: pending.id });
      if (rpcError) {
        setError(erasureErrorText(rpcError.message));
        return;
      }
      toast.success("Deletion cancelled", { description: "Your account stays as it is." });
      await load();
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="mt-8 p-4 rounded-xl border border-red-500/20 bg-red-500/[0.03]">
      <div className="flex items-center gap-2 mb-1">
        <Trash2 className="w-5 h-5 text-red-400" />
        <h2 className="text-lg font-semibold">Delete my account</h2>
      </div>

      {pending === undefined ? (
        <Loader2 className="w-4 h-4 animate-spin text-zinc-500" />
      ) : pending ? (
        <>
          <p className="text-sm text-zinc-300 mb-3">
            Your account will be deleted in {daysUntil(pending.execute_at)} day{daysUntil(pending.execute_at) === 1 ? "" : "s"}. Until then you can still sign in and change your mind.
          </p>
          <button type="button" onClick={() => void cancel()} disabled={busy} className="h-10 px-4 rounded-xl border border-white/10 text-sm text-zinc-200 hover:text-white disabled:opacity-40">
            Cancel deletion
          </button>
        </>
      ) : !open ? (
        <>
          <p className="text-sm text-zinc-500 mb-4">Permanently remove your account and everything in it. You get 7 days to change your mind.</p>
          <button type="button" onClick={() => setOpen(true)} className="h-10 px-4 rounded-xl border border-red-500/30 text-sm text-red-300 hover:text-red-200">
            Delete my account…
          </button>
        </>
      ) : (
        <form onSubmit={request} className="space-y-3">
          <p className="text-sm text-zinc-300">After 7 days this is removed for good:</p>
          <ul className="text-sm text-zinc-400 list-disc pl-5 space-y-1">{ERASE_REMOVES.map((t) => <li key={t}>{t}</li>)}</ul>
          <p className="text-sm text-zinc-300">What we keep:</p>
          <ul className="text-sm text-zinc-500 list-disc pl-5 space-y-1">{ERASE_KEEPS.map((t) => <li key={t}>{t}</li>)}</ul>
          <p className="text-sm text-zinc-300">Type <span className="font-mono text-white">{ERASE_CONFIRM_WORD}</span> to confirm.</p>
          <input
            value={typed}
            onChange={(e) => setTyped(e.target.value)}
            autoComplete="off"
            aria-label="Type DELETE MY ACCOUNT to confirm"
            className="w-full h-11 px-3 bg-white/[0.03] border border-white/10 rounded-xl text-white placeholder:text-white/15 focus:outline-none focus:border-red-400/40"
          />
          <div className="flex gap-2">
            <button type="submit" disabled={busy || !canRequestErasure(typed)} className="flex-1 h-11 rounded-xl text-white text-sm font-semibold disabled:opacity-40 flex items-center justify-center gap-2 bg-red-600">
              {busy ? <Loader2 className="w-4 h-4 animate-spin" /> : null}
              Schedule deletion
            </button>
            <button type="button" onClick={() => { setOpen(false); setTyped(""); setError(null); }} className="px-4 h-11 rounded-xl border border-white/10 text-sm text-zinc-300 hover:text-white">
              Back
            </button>
          </div>
        </form>
      )}
      {error ? <p role="alert" className="text-sm text-red-400 mt-3">{error}</p> : null}
    </div>
  );
};
