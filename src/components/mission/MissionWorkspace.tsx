import React, { useState, useEffect } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { Menu } from "lucide-react";
import { useIsMobile } from "@/hooks/use-mobile";
import MissionSidebar from "./MissionSidebar";
import ActionTerminal from "./ActionTerminal";

interface MissionWorkspaceProps {
  open: boolean;
  onClose: () => void;
  initialSector?: string;
}

const MissionWorkspace: React.FC<MissionWorkspaceProps> = ({ open, onClose, initialSector = "home" }) => {
  const [activeSection, setActiveSection] = useState(initialSector);
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const isMobile = useIsMobile();

  useEffect(() => {
    if (open) {
      setActiveSection(initialSector);
    }
  }, [initialSector, open]);

  if (!open) return null;

  return (
    <AnimatePresence>
      <motion.div
        key="mission-overlay"
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        exit={{ opacity: 0 }}
        className="fixed inset-0 z-[100] flex font-sans selection:bg-blue-500/30"
      >
        {/* Professional Gradient Backdrop: Deep Obsidian to Navy */}
        <div className="absolute inset-0 bg-[#020617] bg-[radial-gradient(circle_at_center,_var(--tw-gradient-stops))] from-[#0f172a] via-[#020617] to-[#020617]" />

        <div className="relative z-10 flex w-full h-full">
          {isMobile ? (
            <>
              {/* Refined Mobile Toggle */}
              <button
                onClick={() => setSidebarOpen(true)}
                className="fixed top-4 left-4 z-[120] w-12 h-12 flex items-center justify-center rounded-xl border border-white/10 bg-white/5 backdrop-blur-xl shadow-lg"
              >
                <Menu size={20} className="text-blue-400" />
              </button>

              <AnimatePresence>
                {sidebarOpen && (
                  <>
                    <motion.div
                      initial={{ opacity: 0 }}
                      animate={{ opacity: 1 }}
                      exit={{ opacity: 0 }}
                      className="fixed inset-0 z-[110] bg-black/60 backdrop-blur-sm"
                      onClick={() => setSidebarOpen(false)}
                    />
                    <motion.div
                      initial={{ x: "-100%" }}
                      animate={{ x: 0 }}
                      exit={{ x: "-100%" }}
                      transition={{ type: "spring", damping: 25, stiffness: 200 }}
                      className="fixed left-0 top-0 bottom-0 z-[115] w-64 bg-[#020617] border-r border-white/5 shadow-2xl"
                    >
                      <MissionSidebar
                        activeSection={activeSection}
                        onSectionChange={(id) => {
                          setActiveSection(id);
                          setSidebarOpen(false);
                        }}
                        onClose={onClose}
                      />
                    </motion.div>
                  </>
                )}
              </AnimatePresence>

              <div className="flex-1 pt-20 px-4">
                <ActionTerminal activeSection={activeSection} />
              </div>
            </>
          ) : (
            <>
              {/* DESKTOP: Glassmorphism Sidebar */}
              <motion.div
                initial={{ opacity: 0, x: -20 }}
                animate={{ opacity: 1, x: 0 }}
                className="w-64 shrink-0 h-full border-r border-white/5 bg-white/[0.02] backdrop-blur-md"
              >
                <MissionSidebar activeSection={activeSection} onSectionChange={setActiveSection} onClose={onClose} />
              </motion.div>

              {/* DESKTOP: Main Workspace Area */}
              <motion.div
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                transition={{ delay: 0.1 }}
                className="flex-1 h-full overflow-hidden bg-gradient-to-br from-blue-500/[0.03] to-transparent"
              >
                <ActionTerminal activeSection={activeSection} />
              </motion.div>
            </>
          )}
        </div>
      </motion.div>
    </AnimatePresence>
  );
};

export default MissionWorkspace;
