import { createRoot } from "react-dom/client";
import App from "./App.tsx";
import "./index.css";

// Debug: check if Supabase env vars are loaded
const url = import.meta.env.VITE_SUPABASE_URL;
const key = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY;
console.log("[NazAI] VITE_SUPABASE_URL:", url ? "✅ set" : "❌ MISSING");
console.log("[NazAI] VITE_SUPABASE_PUBLISHABLE_KEY:", key ? "✅ set" : "❌ MISSING");

const root = document.getElementById("root")!;

if (!url || !key) {
  root.innerHTML = `
    <div style="display:flex;align-items:center;justify-content:center;min-height:100vh;background:#0a0a0a;color:#fff;font-family:sans-serif;text-align:center;padding:2rem;">
      <div>
        <h1 style="font-size:1.5rem;margin-bottom:1rem;">⚠️ NazAI Configuration Error</h1>
        <p style="color:#aaa;">Missing environment variables:</p>
        <ul style="list-style:none;padding:0;margin:1rem 0;color:#f87171;">
          ${!url ? '<li>VITE_SUPABASE_URL</li>' : ''}
          ${!key ? '<li>VITE_SUPABASE_PUBLISHABLE_KEY</li>' : ''}
        </ul>
        <p style="color:#aaa;font-size:0.875rem;">Add these in your hosting provider's environment variables and redeploy.</p>
      </div>
    </div>
  `;
} else {
  createRoot(root).render(<App />);
}
