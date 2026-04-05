import { BrowserRouter, Routes, Route, Navigate } from "react-router-dom";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { AuthProvider } from "@/hooks/useAuth";
import { Toaster } from "@/components/ui/toaster";
import { lazy, Suspense } from "react";

// ─── Route Components ─────────────────────────────────────────────────────────
const Workflower = lazy(() => import("./pages/Workflower"));
const Workspace = lazy(() => import("./pages/Workspace"));
const Signup = lazy(() => import("./pages/Signup"));
const AuthCallback = lazy(() => import("./pages/AuthCallback"));
const Dashboard = lazy(() => import("./pages/Dashboard"));
const Generator = lazy(() => import("./pages/Generator"));

const queryClient = new QueryClient();

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
            {/* Core Routes */}
            <Route path="/" element={<Workflower />} />
            <Route path="/workflower" element={<Workflower />} />
            <Route path="/workspace" element={<Workspace />} />
            
            {/* Auth Routes */}
            <Route path="/signup" element={<Signup />} />
            <Route path="/login" element={<Signup />} />
            <Route path="/auth/callback" element={<AuthCallback />} />
            
            {/* Mission Generator & Dashboard */}
            <Route path="/generate" element={<Generator />} />
            <Route path="/dashboard/*" element={<Dashboard />} />
            
            {/* Catch-all Redirect */}
            <Route path="*" element={<Navigate to="/" replace />} />
          </Routes>
        </Suspense>

        {/* ACCURACY CHECK: 
          The GlobalSaveButton was removed from here. 
          The button is now handled locally within Generator.tsx 
          so it only appears when actual code is generated.
        */}

        <Toaster />
      </BrowserRouter>
    </AuthProvider>
  </QueryClientProvider>
);

export default App;
