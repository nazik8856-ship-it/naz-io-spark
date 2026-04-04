import { BrowserRouter, Routes, Route, Navigate } from "react-router-dom";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { AuthProvider } from "@/hooks/useAuth";
import { Toaster } from "@/components/ui/toaster";
import { Suspense, lazy } from "react";

// Lazy load your pages for better performance
const Index = lazy(() => import("./pages/Index")); // Your Main Landing Page
const Workspace = lazy(() => import("./pages/Workspace")); // Your NazAI OS Terminal

const queryClient = new QueryClient();

// High-density boot loader
const PageSkeleton = () => (
  <div className="min-h-screen flex items-center justify-center bg-[#020606]">
    <div className="flex flex-col items-center gap-4">
      <div className="w-10 h-10 border-2 border-[#00ff80]/30 border-t-[#00ff80] rounded-full animate-spin" />
      <p className="text-[10px] text-[#00ff80] font-black uppercase tracking-[0.3em] animate-pulse">SYNCING_NODES...</p>
    </div>
  </div>
);

const App = () => (
  <QueryClientProvider client={queryClient}>
    <AuthProvider>
      <BrowserRouter>
        <Suspense fallback={<PageSkeleton />}>
          <Routes>
            {/* 1. RESTORED MAIN PAGE: Now visible at NazAI.net */}
            <Route path="/" element={<Index />} />

            {/* 2. WORKSPACE TERMINAL: Now visible at NazAI.net/workspace */}
            <Route path="/workspace" element={<Workspace />} />

            {/* Existing utility routes */}
            <Route path="/signup" element={<Navigate to="/" replace />} />
            <Route path="/login" element={<Navigate to="/" replace />} />

            {/* Global Redirect: Unknown paths go back to home */}
            <Route path="*" element={<Navigate to="/" replace />} />
          </Routes>
        </Suspense>
        <Toaster />
      </BrowserRouter>
    </AuthProvider>
  </QueryClientProvider>
);

export default App;
