import { createRoot } from "react-dom/client";
import App from "./App.tsx";
import "./index.css";
import { initPostHog } from "@/lib/posthog";
import { initSentry } from "@/lib/sentry";
import { clearAccountBrowserStorage, purgeSensitiveBrowserStorage } from "@/lib/browser-storage";
import { supabase } from "@/integrations/supabase/client";

initSentry();
initPostHog();
// Data in transit (security task 2): content and key values older versions left in localStorage go, and signing out clears the
// tab's content (browser-storage.ts).
purgeSensitiveBrowserStorage();
supabase.auth.onAuthStateChange((event) => { if (event === "SIGNED_OUT") clearAccountBrowserStorage(); });

createRoot(document.getElementById("root")!).render(<App />);
