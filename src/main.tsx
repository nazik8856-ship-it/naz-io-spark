import { createRoot } from "react-dom/client";
import App from "./App.tsx";
import "./index.css";
import { checkSupabaseEnv } from "./lib/supabase-guard";

const root = createRoot(document.getElementById("root")!);

function renderApp() {
  const { ready, missing } = checkSupabaseEnv();

  if (!ready) {
    // Show a neo-brutalist loading/error state instead of crashing
    root.render(
      <div style={{
        minHeight: '100vh',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        background: '#0a0a0a',
        color: '#e0e0e0',
        fontFamily: 'monospace',
        fontSize: '1.1rem',
        padding: '2rem',
        textAlign: 'center',
      }}>
        <div style={{ border: '3px solid #333', padding: '2rem', maxWidth: 420 }}>
          <p style={{ marginBottom: '1rem', fontWeight: 700 }}>⏳ Loading NazAI…</p>
          <p style={{ fontSize: '0.85rem', opacity: 0.6 }}>
            Waiting for backend connection. If this persists, check your environment variables: {missing.join(', ')}
          </p>
        </div>
      </div>
    );
    // Retry after a short delay in case env vars load async
    setTimeout(renderApp, 1500);
    return;
  }

  root.render(<App />);
}

renderApp();
