import { BrowserRouter, Routes, Route, Navigate } from "react-router-dom";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { AuthProvider } from "@/hooks/useAuth";
import { Toaster } from "@/components/ui/toaster";
import { Suspense } from "react";
import NazAI_OS from "./pages/Workspace"; // This assumes you put the UI code in Workspace.tsx

const queryClient = new QueryClient();

// Your Obsidian loading skeleton
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
            {/* We are pointing the workspace route to the new UI */}
            <Route path="/" element={<Navigate to="/workspace" replace />} />
            <Route path="/workspace" element={<NazAI_OS />} />

            {/* Keeping your other routes active just in case */}
            <Route path="/signup" element={<div className="text-white p-10">Signup Page</div>} />
            <Route path="*" element={<Navigate to="/workspace" replace />} />
          </Routes>
        </Suspense>
        <Toaster />
      </BrowserRouter>
    </AuthProvider>
  </QueryClientProvider>
);

export default App;
