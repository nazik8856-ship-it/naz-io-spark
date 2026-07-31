import { useMemo, useState } from "react";
import { AlertTriangle, Check, Loader2, Plug, X, ExternalLink } from "lucide-react";
import { toast } from "sonner";
import IntegrationConnectModal from "@/components/agents/IntegrationConnectModal";
import { IntegrationLogo } from "@/components/IntegrationLogos";
import {
  type IntegrationIssue,
  clearIssuesForProvider,
  dismissIssue,
  resolveIssueWithAnswer,
} from "@/lib/integration-issues";

/**
 * Human-facing fix window for known non-retryable blockers.
 * Shows plain language only — never internal log text — plus the one action
 * that actually unblocks the agent (reconnect, or answer once).
 */

/** Map an issue provider onto the connect-catalogue entry that fixes it. */
function catalogueNameFor(provider: string): string {
  const p = provider.toLowerCase();
  if (p.includes("docs") || p.includes("sheets") || p.includes("drive")) return "Google Drive";
  if (p.includes("calendar")) return "Google Calendar";
  if (p.includes("analytics")) return "Google Analytics";
  if (p.includes("gmail") || p === "google") return "Gmail";
  return provider;
}

function IssueCard({
  issue,
  onFixed,
}: {
  issue: IntegrationIssue;
  onFixed: () => void;
}) {
  const [answer, setAnswer] = useState("");
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState(false);
  const [connectOpen, setConnectOpen] = useState(false);
  const options = useMemo(() => {
    const o = (issue.resolution as { options?: unknown } | null)?.options;
    return Array.isArray(o) ? (o as string[]).filter((x) => typeof x === "string") : [];
  }, [issue.resolution]);

  const catalogueName = catalogueNameFor(issue.provider);

  const finish = async (fn: () => Promise<unknown>, msg: string) => {
    setBusy(true);
    try {
      await fn();
      setDone(true);
      toast.success(msg);
      onFixed();
    } catch {
      toast.error("Couldn't save that — please try again.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="rounded-xl border border-border/60 bg-card/70 p-4">
      <div className="flex items-start gap-3">
        <div className="mt-0.5 shrink-0">
          {done ? (
            <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-emerald-500/15 text-emerald-400">
              <Check className="h-4 w-4" />
            </span>
          ) : (
            <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-amber-500/15 text-amber-400">
              <AlertTriangle className="h-4 w-4" />
            </span>
          )}
        </div>
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <IntegrationLogo name={issue.provider} className="h-4 w-4" />
            <h4 className="truncate text-sm font-semibold text-foreground">{issue.title}</h4>
          </div>
          <p className="mt-1 text-sm leading-relaxed text-muted-foreground">{issue.human_message}</p>

          {done ? (
            <p className="mt-3 flex items-center gap-1.5 text-xs font-medium text-emerald-400">
              <Check className="h-3.5 w-3.5" /> Fixed — the agent will carry on from here.
            </p>
          ) : issue.fix_action === "input" ? (
            <div className="mt-3 space-y-2">
              {options.length > 0 && (
                <div className="flex flex-wrap gap-1.5">
                  {options.map((o) => (
                    <button
                      key={o}
                      type="button"
                      onClick={() => setAnswer(o)}
                      className={`rounded-md border px-2 py-1 text-xs transition ${
                        answer === o
                          ? "border-primary bg-primary/15 text-foreground"
                          : "border-border/60 text-muted-foreground hover:text-foreground"
                      }`}
                    >
                      {o}
                    </button>
                  ))}
                </div>
              )}
              <textarea
                value={answer}
                onChange={(e) => setAnswer(e.target.value)}
                rows={2}
                placeholder="Type your answer — NazAI saves it and won't ask again"
                className="w-full resize-none rounded-lg border border-border/60 bg-background/60 px-3 py-2 text-sm text-foreground outline-none focus:border-primary/60"
              />
              <button
                type="button"
                disabled={busy || !answer.trim()}
                onClick={() => finish(() => resolveIssueWithAnswer(issue, answer.trim()), "Saved — NazAI will remember this.")}
                className="inline-flex items-center gap-2 rounded-lg bg-primary px-3 py-1.5 text-xs font-semibold text-primary-foreground disabled:opacity-50"
              >
                {busy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Check className="h-3.5 w-3.5" />}
                Save answer
              </button>
            </div>
          ) : issue.fix_action === "reconnect" ? (
            <div className="mt-3 flex flex-wrap items-center gap-2">
              <button
                type="button"
                onClick={() => setConnectOpen(true)}
                className="inline-flex items-center gap-2 rounded-lg bg-primary px-3 py-1.5 text-xs font-semibold text-primary-foreground"
              >
                <Plug className="h-3.5 w-3.5" /> Reconnect {catalogueName}
              </button>
              <button
                type="button"
                disabled={busy}
                onClick={() => finish(() => clearIssuesForProvider(issue.provider), "Marked as fixed.")}
                className="text-xs text-muted-foreground underline-offset-2 hover:underline"
              >
                I've already fixed this
              </button>
            </div>
          ) : (
            <div className="mt-3 flex flex-wrap items-center gap-2">
              <button
                type="button"
                disabled={busy}
                onClick={() => finish(() => dismissIssue(issue.id), "Marked as fixed.")}
                className="inline-flex items-center gap-2 rounded-lg bg-primary px-3 py-1.5 text-xs font-semibold text-primary-foreground"
              >
                <ExternalLink className="h-3.5 w-3.5" /> I've fixed this in {issue.provider}
              </button>
            </div>
          )}
        </div>
      </div>

      {connectOpen && (
        <IntegrationConnectModal
          integration={{
            name: catalogueName,
            category: "Blocked connection",
            method: "OAuth",
            scopes: issue.scope_hint || undefined,
            examples: [],
            steps: [],
          }}
          onClose={() => setConnectOpen(false)}
          onChange={async () => {
            await clearIssuesForProvider(issue.provider);
            setDone(true);
            onFixed();
          }}
        />
      )}
    </div>
  );
}

export default function IntegrationIssueWindow({
  issues,
  onClose,
  onChanged,
}: {
  issues: IntegrationIssue[];
  onClose: () => void;
  onChanged: () => void;
}) {
  if (!issues.length) return null;
  return (
    <div className="fixed inset-0 z-[80] flex items-center justify-center bg-black/70 p-4 backdrop-blur-sm">
      <div className="w-full max-w-lg overflow-hidden rounded-2xl border border-border/60 bg-background shadow-2xl">
        <div className="flex items-center justify-between border-b border-border/60 px-5 py-3">
          <div>
            <h3 className="text-sm font-semibold text-foreground">Action needed before NazAI can continue</h3>
            <p className="text-xs text-muted-foreground">
              {issues.length} thing{issues.length === 1 ? "" : "s"} only you can fix. Runs skip these steps until then.
            </p>
          </div>
          <button onClick={onClose} className="rounded-md p-1 text-muted-foreground hover:text-foreground">
            <X className="h-4 w-4" />
          </button>
        </div>
        <div className="max-h-[70vh] space-y-3 overflow-y-auto p-4">
          {issues.map((i) => (
            <IssueCard key={i.id} issue={i} onFixed={onChanged} />
          ))}
        </div>
      </div>
    </div>
  );
}
