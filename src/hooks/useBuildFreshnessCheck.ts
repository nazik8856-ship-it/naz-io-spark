import { useEffect } from "react";
import { toast } from "sonner";

// Detects when a newer build has been deployed while this tab stayed open on
// an older one. Real, observed failure mode for this SPA: a fix ships and
// deploys successfully, but a tab opened before the deploy keeps running its
// already-loaded JS forever -- nothing about normal client-side routing ever
// triggers a real page reload, so the user keeps seeing pre-fix behavior and
// has no way to know a newer version even exists. Compares the build id
// baked into THIS bundle (see vite.config.ts) against a static file
// re-fetched fresh from the server (never from cache).
const CHECK_INTERVAL_MS = 10 * 60 * 1000; // 10 minutes
let notified = false;

async function checkForNewBuild() {
  if (notified) return;
  try {
    const resp = await fetch(`/build-id.txt?t=${Date.now()}`, { cache: "no-store" });
    if (!resp.ok) return;
    const latest = (await resp.text()).trim();
    if (latest && latest !== __BUILD_ID__) {
      notified = true;
      toast("A new version of NazAI is available.", {
        description: "Refresh to get the latest fixes and features.",
        duration: Infinity,
        action: {
          label: "Refresh",
          onClick: () => window.location.reload(),
        },
      });
    }
  } catch {
    // Best-effort -- a failed check just means we try again next interval.
  }
}

export function useBuildFreshnessCheck() {
  useEffect(() => {
    checkForNewBuild();
    const interval = setInterval(checkForNewBuild, CHECK_INTERVAL_MS);
    const onVisible = () => { if (document.visibilityState === "visible") checkForNewBuild(); };
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      clearInterval(interval);
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, []);
}
