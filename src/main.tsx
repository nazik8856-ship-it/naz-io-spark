import { createRoot } from "react-dom/client";
import App from "./App.tsx";
import "./index.css";

// Debug: check if Supabase env vars are loaded
console.log("[NazAI] VITE_SUPABASE_URL:", import.meta.env.VITE_SUPABASE_URL ? "✅ set" : "❌ MISSING");
console.log("[NazAI] VITE_SUPABASE_PUBLISHABLE_KEY:", import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY ? "✅ set" : "❌ MISSING");

createRoot(document.getElementById("root")!).render(<App />);
