import { useEffect, useState } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { CheckCircle2, XCircle } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { toast } from "@/hooks/use-toast";

type Preview = { role: string; status: string; invited_email: string };

/** Landing page for an /team/accept?token=... invite link. */
export default function AcceptInvite() {
  const navigate = useNavigate();
  const { user } = useAuth();
  const [params] = useSearchParams();
  const token = params.get("token") || "";
  const [preview, setPreview] = useState<Preview | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [accepting, setAccepting] = useState(false);
  const [accepted, setAccepted] = useState(false);

  useEffect(() => {
    if (!token) { setError("Missing invite token."); return; }
    supabase.functions.invoke(`account-invite-accept?token=${encodeURIComponent(token)}`, { method: "GET" })
      .then(({ data, error: err }) => {
        const res = (data ?? {}) as Preview & { error?: string; message?: string };
        if (err || res.error) { setError(res.message || res.error || err?.message || "Invite not found."); return; }
        setPreview(res);
      });
  }, [token]);

  const accept = async () => {
    if (!user) {
      toast({ title: "Log in first", description: "Log in with the email this invite was sent to, then come back to this link." });
      return;
    }
    setAccepting(true);
    const { data, error: err } = await supabase.functions.invoke("account-invite-accept", { body: { token } });
    setAccepting(false);
    const res = (data ?? {}) as { ok?: boolean; error?: string; message?: string };
    if (err || !res.ok) {
      toast({ title: "Couldn't accept the invite", description: res.message || res.error || err?.message, variant: "destructive" });
      return;
    }
    setAccepted(true);
    toast({ title: "You're in" });
  };

  return (
    <div className="flex min-h-screen w-full items-center justify-center text-white" style={{ backgroundColor: "#020617" }}>
      <div className="w-full max-w-sm rounded-lg border border-white/10 bg-white/[0.03] p-6 text-center">
        {accepted ? (
          <>
            <CheckCircle2 className="mx-auto h-8 w-8 text-emerald-400" />
            <h1 className="mt-3 text-lg font-semibold">You've joined the team</h1>
            <button
              onClick={() => navigate("/control-system")}
              className="mt-4 rounded border border-cyan-500/40 bg-cyan-500/10 px-4 py-2 text-xs font-mono uppercase text-cyan-300 hover:bg-cyan-500/20"
            >
              Go to Control System
            </button>
          </>
        ) : error ? (
          <>
            <XCircle className="mx-auto h-8 w-8 text-rose-400" />
            <h1 className="mt-3 text-lg font-semibold">Invite not available</h1>
            <p className="mt-1 text-sm text-zinc-400">{error}</p>
          </>
        ) : preview ? (
          <>
            <h1 className="text-lg font-semibold">You're invited</h1>
            <p className="mt-2 text-sm text-zinc-400">
              As <span className="text-zinc-200">{preview.role}</span> for {preview.invited_email}.
            </p>
            <button
              disabled={accepting}
              onClick={accept}
              className="mt-4 rounded border border-cyan-500/40 bg-cyan-500/10 px-4 py-2 text-xs font-mono uppercase text-cyan-300 hover:bg-cyan-500/20 disabled:opacity-50"
            >
              {accepting ? "Accepting…" : "Accept invitation"}
            </button>
          </>
        ) : (
          <p className="font-mono text-xs uppercase text-zinc-500">Loading…</p>
        )}
      </div>
    </div>
  );
}
