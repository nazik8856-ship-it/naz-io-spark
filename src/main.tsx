import { createRoot } from "react-dom/client";
import App from "./App.tsx";
import "./index.css";
import { initPostHog } from "@/lib/posthog";
import { initSentry } from "@/lib/sentry";

initSentry();
initPostHog();

createRoot(document.getElementById("root")!).render(<App />);
