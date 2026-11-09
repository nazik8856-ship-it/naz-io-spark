import { createRoot } from "react-dom/client";
import App from "./App.tsx";
import "./index.css";
import { initPostHog } from "@/lib/posthog";
import { initSentry } from "@/lib/sentry";
import { purgeSensitiveBrowserStorage } from "@/lib/browser-storage";
import { queryClient } from "@/lib/query-client";
import { resetClientState, watchSession } from "@/lib/session-reset";
import { supabase } from "@/integrations/supabase/client";

initSentry();
initPostHog();
// Data in transit (security task 2): content and key values older versions left in localStorage go, and signing out clears the
// tab's content (browser-storage.ts).
purgeSensitiveBrowserStorage();
// Session and access isolation (task 5): signing out, or another person signing in, empties what the previous session left in the page.
watchSession(supabase.auth, (change) => resetClientState({ queryClient, removeAllChannels: () => supabase.removeAllChannels() }, change));

createRoot(document.getElementById("root")!).render(<App />);
