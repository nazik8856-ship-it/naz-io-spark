import { useEffect, useState } from "react";
import { useNavigate, Outlet } from "react-router-dom";
import { useAuth } from "@/hooks/useAuth";

const AuthSkeleton = () => (
  <div className="min-h-screen flex items-center justify-center" style={{ background: "#020617" }}>
    <div className="flex flex-col items-center gap-4">
      <div className="w-10 h-10 border-2 border-[#00A3FF]/30 border-t-[#00A3FF] rounded-full animate-spin" />
      <p className="text-sm text-white/30 font-medium">Verifying session…</p>
    </div>
  </div>
);

export const AuthGuard = () => {
  const { user, loading } = useAuth();
  const navigate = useNavigate();

  useEffect(() => {
    if (!loading && !user) {
      navigate("/", { replace: true });
    }
  }, [loading, user, navigate]);

  if (loading) return <AuthSkeleton />;
  return user ? <Outlet /> : null;
};
