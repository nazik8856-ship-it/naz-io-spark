import React, { useState, useEffect } from "react";
import { motion } from "framer-motion";
import { useAuth } from "@/hooks/useAuth";
import { useNavigate } from "react-router-dom";
import MissionWorkspace from "@/components/mission/MissionWorkspace";

const Workspace = () => {
  const { user, loading } = useAuth();
  const navigate = useNavigate();
  const [directive] = useState(() => {
    const saved = sessionStorage.getItem("nazai_directive");
    sessionStorage.removeItem("nazai_directive");
    return saved || "";
  });
  const [hydrating, setHydrating] = useState(true);

  useEffect(() => {
    if (!loading && !user) {
      navigate("/", { replace: true });
    }
  }, [loading, user, navigate]);

  useEffect(() => {
    if (user) {
      const timer = setTimeout(() => setHydrating(false), 1800);
      return () => clearTimeout(timer);
    }
  }, [user]);

  if (loading || !user) return null;

  if (hydrating) {
    return (
      <div
        className="min-h-screen flex items-center justify-center"
        style={{ background: "#020617", fontFamily: "'Inter', sans-serif" }}
      >
        <motion.div
          initial={{ opacity: 0, y: 10 }}
          animate={{ opacity: 1, y: 0 }}
          className="flex flex-col items-center gap-6 max-w-md text-center px-6"
        >
          <div className="w-12 h-12 border-2 border-[#00A3FF]/30 border-t-[#00A3FF] rounded-full animate-spin" />
          <div>
            <h2 className="text-lg font-semibold text-white mb-2">
              {directive
                ? `Orchestrating Solution…`
                : "Initializing Workspace…"}
            </h2>
            {directive && (
              <p className="text-sm text-white/30 line-clamp-2">"{directive}"</p>
            )}
          </div>
          {/* Progress bar */}
          <div className="w-full max-w-xs h-1 rounded-full bg-white/5 overflow-hidden">
            <motion.div
              className="h-full rounded-full"
              style={{ background: "#00A3FF" }}
              initial={{ width: "0%" }}
              animate={{ width: "100%" }}
              transition={{ duration: 1.6, ease: "easeInOut" }}
            />
          </div>
          <p className="text-xs text-white/20">Preparing your environment</p>
        </motion.div>
      </div>
    );
  }

  return (
    <MissionWorkspace
      open={true}
      onClose={() => navigate("/")}
      initialSector="home"
      initialDirective={directive}
    />
  );
};

export default Workspace;
