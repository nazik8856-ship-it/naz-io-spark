import { useState, useEffect } from "react";
import { Toaster } from "@/components/ui/toaster";
import { Toaster as Sonner } from "@/components/ui/sonner";
import { TooltipProvider } from "@/components/ui/tooltip";
import { AuthGuard } from "@/components/AuthGuard";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { BrowserRouter, Routes, Route } from "react-router-dom";
import { AuthProvider } from "@/hooks/useAuth";
import { isSupabaseReady } from "@/lib/supabase-guard";
import Index from "./pages/Index";
import Signup from "./pages/Signup";
import Login from "./pages/Login";
import Dashboard from "./pages/Dashboard";
import SharedWebsite from "./pages/SharedWebsite";
import AuthCallback from "./pages/AuthCallback";
import NotFound from "./pages/NotFound";
import Privacy from "./pages/Privacy";
import Terms from "./pages/Terms";

const queryClient = new QueryClient();

const App = () => {
  const [ready, setReady] = useState(isSupabaseReady());
  const isStaticLegalPage = typeof window !== "undefined" && ["/privacy", "/terms"].includes(window.location.pathname);

  useEffect(() => {
    if (ready) return;
    let attempts = 0;
    const interval = setInterval(() => {
      attempts++;
      if (isSupabaseReady()) {
        setReady(true);
        clearInterval(interval);
      } else if (attempts > 10) {
        // Stop retrying after ~5s, show app anyway (it will show errors naturally)
        setReady(true);
        clearInterval(interval);
      }
    }, 500);
    return () => clearInterval(interval);
  }, [ready]);

  if (!ready && !isStaticLegalPage) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-background">
        <div className="border-4 border-foreground/20 p-8 text-center space-y-3 max-w-sm">
          <div className="w-10 h-10 border-4 border-foreground border-t-transparent rounded-full animate-spin mx-auto" />
          <p className="font-mono text-foreground text-lg font-bold">Loading NazAI…</p>
        </div>
      </div>
    );
  }

  return (
    <QueryClientProvider client={queryClient}>
      <TooltipProvider>
        <AuthProvider>
          <Toaster />
          <Sonner />
          <BrowserRouter>
            <Routes>
              <Route path="/privacy" element={<Privacy />} />
              <Route path="/terms" element={<Terms />} />
              <Route path="/" element={<Index />} />
              <Route path="/signup" element={<Signup />} />
              <Route path="/login" element={<Login />} />
              <Route path="/auth/callback" element={<AuthCallback />} />
              <Route element={<AuthGuard />}>
                <Route path="/dashboard" element={<Dashboard />} />
                <Route path="/dashboard/create" element={<Dashboard />} />
                <Route path="/dashboard/projects" element={<Dashboard />} />
                <Route path="/dashboard/trash" element={<Dashboard />} />
              </Route>
              <Route path="/share/:id" element={<SharedWebsite />} />
              <Route path="*" element={<NotFound />} />
            </Routes>
          </BrowserRouter>
        </AuthProvider>
      </TooltipProvider>
    </QueryClientProvider>
  );
};

export default App;
