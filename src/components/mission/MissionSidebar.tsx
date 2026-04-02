import React from "react";
import { Home, Clock, Archive, Trash2, X, Cpu, ShieldCheck } from "lucide-react";

const NAV_ITEMS = [
  { id: "home", label: "Home", icon: Home },
  { id: "recents", label: "Recents", icon: Clock },
  { id: "archives", label: "Archives", icon: Archive },
  { id: "trash", label: "Trash", icon: Trash2 },
];

interface MissionSidebarProps {
  activeSection: string;
  onSectionChange: (id: string) => void;
  onClose: () => void;
}

const MissionSidebar: React.FC<MissionSidebarProps> = ({ activeSection, onSectionChange, onClose }) => {
  return (
    <div
      className="h-full flex flex-col border-r border-white/5"
      style={{ background: "#020617" }}
    >
      {/* Brand header */}
      <div className="flex items-center justify-between px-5 py-5 border-b border-white/5">
        <div className="flex items-center gap-3">
          <div className="w-8 h-8 rounded-lg border border-[#00A3FF]/20 flex items-center justify-center bg-[#00A3FF]/5">
            <Cpu size={14} className="text-[#00A3FF]" />
          </div>
          <span className="text-sm font-semibold text-white tracking-tight">
            Workspace
          </span>
        </div>
        <button
          onClick={onClose}
          className="w-7 h-7 flex items-center justify-center rounded-lg border border-white/5 hover:border-white/10 hover:bg-white/[0.03] transition-all"
        >
          <X size={14} className="text-white/40" />
        </button>
      </div>

      {/* Nav items */}
      <nav className="flex-1 py-3 px-3 space-y-0.5">
        {NAV_ITEMS.map((item) => {
          const isActive = activeSection === item.id;
          return (
            <button
              key={item.id}
              onClick={() => onSectionChange(item.id)}
              className={`w-full flex items-center gap-3 px-3 py-2.5 rounded-lg text-left transition-all ${
                isActive
                  ? "bg-[#00A3FF]/10 text-white"
                  : "text-white/40 hover:text-white/70 hover:bg-white/[0.03]"
              }`}
            >
              <item.icon size={16} className={isActive ? "text-[#00A3FF]" : "text-white/30"} />
              <span className="text-sm font-medium">{item.label}</span>
              {isActive && (
                <div className="ml-auto w-1.5 h-1.5 rounded-full bg-[#00A3FF]" />
              )}
            </button>
          );
        })}
      </nav>

      {/* Synchronized status footer */}
      <div className="px-4 py-4 border-t border-white/5">
        <div className="flex flex-col items-center gap-2 py-3">
          <ShieldCheck size={16} className="text-[#00A3FF]/30" />
          <span className="text-[9px] font-mono text-white/20 uppercase tracking-[0.2em]">
            Secure_Node // Synchronized
          </span>
        </div>
      </div>
    </div>
  );
};

export default MissionSidebar;
