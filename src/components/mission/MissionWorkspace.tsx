import React, { useEffect, useState } from "react";
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
      setSidebarOpen(false);
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
        className="fixed inset-0 z-[100] flex font-mono"
      >
        {/* Backdrop */}
        <div className="absolute inset-0 bg-black/95" />

        {/* Content layer */}
        <div className="relative z-10 flex w-full h-full">
          {/* MOBILE: slide-out drawer sidebar */}
          {isMobile ? (
            <>
              {/* Mobile toggle */}
              <button
                onClick={() => setSidebarOpen(true)}
                className="fixed top-3 left-3 z-[120] w-10 h-10 flex items-center justify-center border border-[#00A3FF]/40 bg-black shadow-[0_0_10px_rgba(0,163,255,0.2)]"
              >
                <Menu size={18} className="text-[#00A3FF]" />
              </button>

              {/* Drawer overlay */}
              <AnimatePresence>
                {sidebarOpen && (
                  <>
                    <motion.div
                      initial={{ opacity: 0 }}
                      animate={{ opacity: 1 }}
                      exit={{ opacity: 0 }}
                      className="fixed inset-0 z-[110] bg-black/70"
                      onClick={() => setSidebarOpen(false)}
                    />
                    <motion.div
                      initial={{ x: "-100%" }}
                      animate={{ x: 0 }}
                      exit={{ x: "-100%" }}
                      transition={{ type: "spring", damping: 30, stiffness: 300 }}
                      className="fixed left-0 top-0 bottom-0 z-[115] w-56"
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

              {/* Mobile terminal (full width) */}
              <div className="flex-1 pt-14">
                <ActionTerminal activeSection={activeSection} />
              </div>
            </>
          ) : (
            <>
              {/* DESKTOP: fixed slim sidebar */}
              <motion.div
                initial={{ x: -200 }}
                animate={{ x: 0 }}
                transition={{ type: "spring", damping: 25, stiffness: 250 }}
                className="w-56 shrink-0 h-full"
              >
                <MissionSidebar
                  activeSection={activeSection}
                  onSectionChange={setActiveSection}
                  onClose={onClose}
                />
              </motion.div>

              {/* DESKTOP: action terminal */}
              <motion.div
                initial={{ opacity: 0, x: 40 }}
                animate={{ opacity: 1, x: 0 }}
                transition={{ delay: 0.15, duration: 0.5 }}
                className="flex-1 h-full"
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
