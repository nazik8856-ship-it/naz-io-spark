import { lazy, Suspense } from "react";
import { BrowserRouter, Routes, Route, Navigate } from "react-router-dom";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { AuthProvider } from "@/hooks/useAuth";
import { Toaster } from "@/components/ui/toaster";

const Generator = lazy(() => import("./pages/Generator"));
const Signup = lazy(() => import("./pages/Signup"));
const AuthCallback = lazy(() => import("./pages/AuthCallback"));

const queryClient = new QueryClient();

const PageSkeleton = () => (
  <div
    className="min-h-screen flex items-center justify-center"
    style={{ background: "#020617" }}
  >
    <div className="flex flex-col items-center gap-4">
      <div className="w-10 h-10 border-2 border-[#00A3FF]/30 border-t-[#00A3FF] rounded-full animate-spin" />
      <p className="text-sm text-white/30 font-medium">Loading NazAI…</p>
    </div>
  </div>
);

const App = () => (
  <QueryClientProvider client={queryClient}>
    <AuthProvider>
      <BrowserRouter>
        <Suspense fallback={<PageSkeleton />}>
          <Routes>
            <Route path="/" element={<Generator />} />
            <Route path="/generate" element={<Generator />} />
            <Route path="/signup" element={<Signup />} />
            <Route path="/login" element={<Signup />} />
            <Route path="/auth/callback" element={<AuthCallback />} />
            <Route path="/dashboard" element={<Navigate to="/generate" replace />} />
            <Route path="/dashboard/*" element={<Navigate to="/generate" replace />} />
            <Route path="*" element={<Navigate to="/" replace />} />
          </Routes>
        </Suspense>
        <Toaster />
      </BrowserRouter>
    </AuthProvider>
  </QueryClientProvider>
);

export default App;
