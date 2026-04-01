import React from "react";
import { Home, Clock, Archive, Trash2, X, Cpu } from "lucide-react";
import { motion } from "framer-motion";

const NAV_ITEMS = [
  { id: "home", label: "HOME", icon: Home },
  { id: "recents", label: "RECENTS", icon: Clock },
  { id: "archives", label: "ARCHIVES", icon: Archive },
  { id: "trash", label: "TRASH", icon: Trash2 },
];

interface MissionSidebarProps {
  activeSection: string;
  onSectionChange: (id: string) => void;
  onClose: () => void;
}

const MissionSidebar: React.FC<MissionSidebarProps> = ({ activeSection, onSectionChange, onClose }) => {
  return (
    <div className="h-full flex flex-col bg-black border-r border-[#00A3FF]/30 shadow-[1px_0_15px_rgba(0,163,255,0.15)]">
      {/* Brand header */}
      <div className="flex items-center justify-between px-4 py-5 border-b border-[#00A3FF]/20">
        <div className="flex items-center gap-3">
          <div className="w-8 h-8 border border-[#00A3FF]/50 flex items-center justify-center bg-[#00A3FF]/10 shadow-[0_0_12px_rgba(0,163,255,0.3)]">
            <Cpu size={16} className="text-[#00A3FF]" />
          </div>
          <span className="text-[10px] font-black text-white uppercase tracking-[0.3em]">
            MISSION_CTL
          </span>
        </div>
        <button
          onClick={onClose}
          className="w-7 h-7 flex items-center justify-center border border-white/10 hover:border-[#FF0055]/50 hover:bg-[#FF0055]/10 transition-all"
        >
          <X size={14} className="text-white/50 hover:text-[#FF0055]" />
        </button>
      </div>

      {/* Nav items */}
      <nav className="flex-1 py-4 px-2 space-y-1">
        {NAV_ITEMS.map((item) => {
          const isActive = activeSection === item.id;
          return (
            <button
              key={item.id}
              onClick={() => onSectionChange(item.id)}
              className={`w-full flex items-center gap-3 px-3 py-3 text-left transition-all group ${
                isActive
                  ? "bg-[#00A3FF]/10 border border-[#00A3FF]/40 shadow-[0_0_10px_rgba(0,163,255,0.15)]"
                  : "border border-transparent hover:border-white/5 hover:bg-white/[0.02]"
              }`}
            >
              <item.icon
                size={16}
                className={isActive ? "text-[#00A3FF]" : "text-white/30 group-hover:text-white/60"}
              />
              <span
                className={`text-[9px] font-black uppercase tracking-[0.25em] ${
                  isActive ? "text-[#00A3FF]" : "text-white/40 group-hover:text-white/70"
                }`}
              >
                {item.label}
              </span>
              {isActive && (
                <div className="ml-auto w-1.5 h-1.5 bg-[#00A3FF] shadow-[0_0_6px_#00A3FF]" />
              )}
            </button>
          );
        })}
      </nav>

      {/* Status footer */}
      <div className="px-4 py-4 border-t border-[#00A3FF]/10">
        <div className="flex items-center gap-2">
          <div className="w-1.5 h-1.5 bg-[#39FF14] animate-pulse shadow-[0_0_6px_#39FF14]" />
          <span className="text-[7px] text-[#39FF14]/70 uppercase tracking-[0.3em] font-bold">
            CORE_ONLINE
          </span>
        </div>
      </div>
    </div>
  );
};

export default MissionSidebar;
