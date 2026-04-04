import { BrowserRouter, Routes, Route, Navigate } from "react-router-dom";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { AuthProvider } from "@/hooks/useAuth";
import { Toaster } from "@/components/ui/toaster";
import { Suspense, lazy } from "react";

// Dynamically importing the restored Terminal UI
const NazAI_OS = lazy(() => import("./pages/Workspace"));

const queryClient = new QueryClient();

/**
 * RESTORED SYSTEM SKELETON
 * Replaces the old blue loader with the high-density NazAI terminal boot screen.
 */
const PageSkeleton = () => (
  <div className="min-h-screen flex items-center justify-center bg-[#020606]">
    <div className="flex flex-col items-center gap-4">
      <div className="w-10 h-10 border-2 border-[#00ff80]/30 border-t-[#00ff80] rounded-full animate-spin" />
      <p className="text-[10px] text-[#00ff80] font-black uppercase tracking-[0.3em] animate-pulse">
        Initializing NazAI OS...
      </p>
    </div>
  </div>
);

const App = () => (
  <QueryClientProvider client={queryClient}>
    <AuthProvider>
      <BrowserRouter>
        <Suspense fallback={<PageSkeleton />}>
          <Routes>
            {/* Redirecting root to the workspace to ensure immediate operator access */}
            <Route path="/" element={<Navigate to="/workspace" replace />} />

            {/* The core terminal route */}
            <Route path="/workspace" element={<NazAI_OS />} />

            {/* Keeping existing functional routes for system integrity */}
            <Route
              path="/signup"
              element={<div className="text-white p-10 font-mono">SYSTEM_ERR: SIGNUP_NODE_OFFLINE</div>}
            />
            <Route
              path="/login"
              element={<div className="text-white p-10 font-mono">SYSTEM_ERR: LOGIN_NODE_OFFLINE</div>}
            />

            {/* Global Redirect: Any invalid path returns the operator to the Terminal */}
            <Route path="*" element={<Navigate to="/workspace" replace />} />
          </Routes>
        </Suspense>
        <Toaster />
      </BrowserRouter>
    </AuthProvider>
  </QueryClientProvider>
);

export default App;
