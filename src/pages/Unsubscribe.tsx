import { useEffect, useState } from "react";
import { useSearchParams, Link } from "react-router-dom";
import { Loader2, CheckCircle2, AlertTriangle, Mail } from "lucide-react";
import { Button } from "@/components/ui/button";

const SUPABASE_URL = import.meta.env.VITE_SUPABASE_URL as string;
const SUPABASE_ANON_KEY =
  (import.meta.env.VITE_SUPABASE_ANON_KEY as string) ||
  (import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY as string);

type Phase = "validating" | "ready" | "submitting" | "done" | "already" | "invalid";

export default function Unsubscribe() {
  const [params] = useSearchParams();
  const token = params.get("token");
  const [phase, setPhase] = useState<Phase>("validating");
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!token) {
      setPhase("invalid");
      setError("Missing unsubscribe token in the link.");
      return;
    }

    let cancelled = false;
    (async () => {
      try {
        const res = await fetch(
          `${SUPABASE_URL}/functions/v1/handle-email-unsubscribe?token=${encodeURIComponent(token)}`,
          { headers: { apikey: SUPABASE_ANON_KEY } },
        );
        const json = await res.json().catch(() => ({}));
        if (cancelled) return;

        if (res.status === 404) {
          setPhase("invalid");
          setError("This unsubscribe link is invalid or has expired.");
          return;
        }
        if (json.reason === "already_unsubscribed") {
          setPhase("already");
          return;
        }
        if (json.valid) {
          setPhase("ready");
          return;
        }
        setPhase("invalid");
        setError("Could not validate this link.");
      } catch {
        if (!cancelled) {
          setPhase("invalid");
          setError("Network error. Please try again.");
        }
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [token]);

  const handleConfirm = async () => {
    if (!token) return;
    setPhase("submitting");
    try {
      const res = await fetch(`${SUPABASE_URL}/functions/v1/handle-email-unsubscribe`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          apikey: SUPABASE_ANON_KEY,
        },
        body: JSON.stringify({ token }),
      });
      const json = await res.json().catch(() => ({}));
      if (json.success || json.reason === "already_unsubscribed") {
        setPhase("done");
      } else {
        setPhase("invalid");
        setError(json.error || "Could not process unsubscribe.");
      }
    } catch {
      setPhase("invalid");
      setError("Network error. Please try again.");
    }
  };

  return (
    <div className="min-h-screen flex items-center justify-center bg-background px-4">
      <div className="w-full max-w-md rounded-2xl border border-border bg-card/60 backdrop-blur-xl p-8 shadow-2xl">
        <div className="flex items-center gap-2 mb-6">
          <Mail className="h-5 w-5 text-primary" />
          <span className="text-sm font-semibold tracking-wide text-foreground">
            NazAI Email Preferences
          </span>
        </div>

        {phase === "validating" && (
          <div className="flex flex-col items-center text-center py-6">
            <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
            <p className="mt-4 text-sm text-muted-foreground">Validating your link…</p>
          </div>
        )}

        {phase === "ready" && (
          <>
            <h1 className="text-2xl font-semibold text-foreground mb-2">
              Unsubscribe from NazAI emails?
            </h1>
            <p className="text-sm text-muted-foreground mb-6 leading-relaxed">
              You'll stop receiving product and account emails from NazAI. You can resubscribe
              anytime by signing in to your account.
            </p>
            <div className="flex gap-3">
              <Button onClick={handleConfirm} className="flex-1">
                Confirm unsubscribe
              </Button>
              <Button asChild variant="outline" className="flex-1">
                <Link to="/">Cancel</Link>
              </Button>
            </div>
          </>
        )}

        {phase === "submitting" && (
          <div className="flex flex-col items-center text-center py-6">
            <Loader2 className="h-8 w-8 animate-spin text-primary" />
            <p className="mt-4 text-sm text-muted-foreground">Processing…</p>
          </div>
        )}

        {phase === "done" && (
          <div className="text-center py-2">
            <CheckCircle2 className="h-10 w-10 text-primary mx-auto mb-3" />
            <h1 className="text-xl font-semibold text-foreground mb-2">You're unsubscribed</h1>
            <p className="text-sm text-muted-foreground mb-6">
              We won't email you again. Sorry to see you go.
            </p>
            <Button asChild variant="outline">
              <Link to="/">Return to NazAI</Link>
            </Button>
          </div>
        )}

        {phase === "already" && (
          <div className="text-center py-2">
            <CheckCircle2 className="h-10 w-10 text-muted-foreground mx-auto mb-3" />
            <h1 className="text-xl font-semibold text-foreground mb-2">Already unsubscribed</h1>
            <p className="text-sm text-muted-foreground mb-6">
              This email address is already opted out of NazAI emails.
            </p>
            <Button asChild variant="outline">
              <Link to="/">Return to NazAI</Link>
            </Button>
          </div>
        )}

        {phase === "invalid" && (
          <div className="text-center py-2">
            <AlertTriangle className="h-10 w-10 text-destructive mx-auto mb-3" />
            <h1 className="text-xl font-semibold text-foreground mb-2">Link not valid</h1>
            <p className="text-sm text-muted-foreground mb-6">
              {error ?? "This unsubscribe link is invalid or has expired."}
            </p>
            <Button asChild variant="outline">
              <Link to="/">Return to NazAI</Link>
            </Button>
          </div>
        )}
      </div>
    </div>
  );
}
