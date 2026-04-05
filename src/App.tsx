import { BrowserRouter, Routes, Route, Navigate } from "react-router-dom";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { AuthProvider } from "@/hooks/useAuth";
import { Toaster } from "@/components/ui/toaster";
import { lazy, Suspense, useState } from "react";
import { DatabaseZap, CheckCircle2, Loader2, XCircle } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";

const Workflower = lazy(() => import("./pages/Workflower"));
const Workspace = lazy(() => import("./pages/Workspace"));
const Signup = lazy(() => import("./pages/Signup"));
const AuthCallback = lazy(() => import("./pages/AuthCallback"));
const Dashboard = lazy(() => import("./pages/Dashboard"));
const Generator = lazy(() => import("./pages/Generator"));

const queryClient = new QueryClient();

type SaveState = "idle" | "saving" | "success" | "error";

// ── Persistent floating Save button — lives at root, always visible ──────────
const GlobalSaveButton = () => {
  const [saveState, setSaveState] = useState<SaveState>("idle");

  const handleSave = async () => {
    if (saveState === "saving") return;
    setSaveState("saving");
    try {
      const html = sessionStorage.getItem("nazai_last_html") || "<p>No content yet.</p>";
      const prompt = sessionStorage.getItem("nazai_last_prompt") || "Untitled Mission";
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) throw new Error("Not authenticated.");
      const { error } = await supabase.from("projects").insert({
        user_id: user.id,
        title: prompt.slice(0, 80),
        html,
        prompt,
        status: "active",
      });
      if (error) throw new Error(error.message);
      setSaveState("success");
      setTimeout(() => setSaveState("idle"), 3000);
    } catch {
      setSaveState("error");
      setTimeout(() => setSaveState("idle"), 3000);
    }
  };

  const label =
    saveState === "saving" ? "Syncing..." :
    saveState === "success" ? "Saved \u2713" :
    saveState === "error" ? "Error \u2014 Retry" :
    "Save to Database";

  const borderColor =
    saveState === "success" ? "#22c55e" :
    saveState === "error" ? "#ef4444" :
    saveState === "saving" ? "#eab308" :
    "rgba(16,185,129,0.6)";

  const bgColor =
    saveState === "success" ? "rgba(34,197,94,0.15)" :
    saveState === "error" ? "rgba(239,68,68,0.15)" :
    saveState === "saving" ? "rgba(234,179,8,0.1)" :
    "rgba(16,185,129,0.12)";

  const textColor =
    saveState === "success" ? "#22c55e" :
    saveState === "error" ? "#ef4444" :
    saveState === "saving" ? "#eab308" :
    "#10b981";

  return (
    <button
      onClick={handleSave}
      title="Archive to NazAI Database"
      style={{
        position: "fixed",
        bottom: "32px",
        right: "32px",
        zIndex: 9999,
        display: "flex",
        alignItems: "center",
        gap: "10px",
        padding: "12px 22px",
        borderRadius: "9999px",
        border: `2px solid ${borderColor}`,
        background: bgColor,
        color: textColor,
        boxShadow: saveState === "success" ? "0 0 24px rgba(34,197,94,0.3)" : saveState === "error" ? "0 0 24px rgba(239,68,68,0.3)" : "0 8px 32px rgba(0,0,0,0.5)",
        fontFamily: "monospace",
        fontWeight: 700,
        fontSize: "11px",
        letterSpacing: "0.15em",
        textTransform: "uppercase",
        cursor: saveState === "saving" ? "not-allowed" : "pointer",
        transition: "all 0.3s ease",
        backdropFilter: "blur(12px)",
        WebkitBackdropFilter: "blur(12px)",
      }}
    >
      {saveState === "saving" ? <Loader2 style={{ width: 16, height: 16, animation: "spin 1s linear infinite" }} /> :
       saveState === "success" ? <CheckCircle2 style={{ width: 16, height: 16 }} /> :
       saveState === "error" ? <XCircle style={{ width: 16, height: 16 }} /> :
       <DatabaseZap style={{ width: 16, height: 16 }} />}
      {label}
    </button>
  );
};

// Obsidian loading skeleton
const PageSkeleton = () => (
  <div className="min-h-screen flex items-center justify-center" style={{ background: "#020617" }}>
    <div className="flex flex-col items-center gap-4">
      <div className="w-10 h-10 border-2 border-[#00A3FF]/30 border-t-[#00A3FF] rounded-full animate-spin" />
      <p className="text-sm text-white/30 font-medium">Loading…</p>
    </div>
  </div>
);

const App = () => (
  <QueryClientProvider client={queryClient}>
    <AuthProvider>
      <BrowserRouter>
        <Suspense fallback={<PageSkeleton />}>
          <Routes>
            <Route path="/" element={<Workflower />} />
            <Route path="/workflower" element={<Workflower />} />
            <Route path="/workspace" element={<Workspace />} />
            <Route path="/signup" element={<Signup />} />
            <Route path="/login" element={<Signup />} />
            <Route path="/auth/callback" element={<AuthCallback />} />
            <Route path="/generate" element={<Generator />} />
            <Route path="/dashboard/*" element={<Dashboard />} />
            <Route path="*" element={<Navigate to="/" replace />} />
          </Routes>
        </Suspense>

        {/* Persistent Save Button — always visible, no guards */}
        <GlobalSaveButton />

        <Toaster />
      </BrowserRouter>
    </AuthProvider>
  </QueryClientProvider>
);

export default App;
