import { useEffect } from "react";
import { useNavigate } from "react-router-dom";
import { useAuth } from "@/hooks/useAuth";

const AuthCallback = () => {
  const navigate = useNavigate();
  const { user, loading, refreshSession } = useAuth();

  useEffect(() => {
    refreshSession().catch((error) => {
      console.error("Auth callback error:", error);
    });
  }, [refreshSession]);

  useEffect(() => {
    if (loading) return;
    navigate(user ? "/dashboard/create" : "/login", { replace: true });
  }, [loading, user, navigate]);

  return (
    <div className="min-h-screen flex items-center justify-center bg-background">
      <div className="border-4 border-foreground/20 p-8 text-center space-y-3 max-w-sm">
        <div className="w-10 h-10 border-4 border-foreground border-t-transparent rounded-full animate-spin mx-auto" />
        <p className="font-mono text-foreground text-lg font-bold">Signing you in…</p>
      </div>
    </div>
  );
};

export default AuthCallback;
