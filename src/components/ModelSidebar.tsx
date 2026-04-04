import { Cpu } from "lucide-react";

const MODELS = [
  { id: "google/gemini-2.0-flash-001", label: "Gemini 2.0 Flash", provider: "Google" },
  { id: "google/gemini-2.5-pro", label: "Gemini 2.5 Pro", provider: "Google" },
  { id: "openai/gpt-5-mini", label: "GPT-5 Mini", provider: "OpenAI" },
  { id: "openai/gpt-5", label: "GPT-5", provider: "OpenAI" },
];

interface ModelSidebarProps {
  activeModel: string;
  onModelChange: (model: string) => void;
}

const ModelSidebar = ({ activeModel, onModelChange }: ModelSidebarProps) => (
  <div className="flex flex-col h-full p-4">
    <div className="flex items-center gap-2 mb-6">
      <Cpu className="w-4 h-4 text-blue-400" />
      <span className="text-[10px] uppercase tracking-[0.2em] text-slate-500 font-bold">Models</span>
    </div>
    <div className="space-y-1">
      {MODELS.map((m) => (
        <button
          key={m.id}
          onClick={() => onModelChange(m.id)}
          className={`w-full text-left px-3 py-2.5 rounded-lg text-xs transition-colors ${
            activeModel === m.id
              ? "bg-blue-600/10 text-blue-400 border border-blue-500/20"
              : "text-slate-400 hover:bg-white/5 border border-transparent"
          }`}
        >
          <div className="font-medium">{m.label}</div>
          <div className="text-[10px] text-slate-600 mt-0.5">{m.provider}</div>
        </button>
      ))}
    </div>
  </div>
);

export default ModelSidebar;
