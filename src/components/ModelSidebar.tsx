import { useState } from "react";
import { Cpu, ChevronRight, ChevronLeft, Zap } from "lucide-react";

export interface AIModel {
  id: string;
  name: string;
  provider: string;
  color: string;
  description: string;
  enabled: boolean;
}

const DEFAULT_MODELS: AIModel[] = [
  {
    id: "gemini-2.0-flash",
    name: "Gemini 2.0 Flash",
    provider: "Google",
    color: "#4285F4",
    description: "Fast & multimodal",
    enabled: true,
  },
  {
    id: "gemini-2.5-flash",
    name: "Gemini 2.5 Flash",
    provider: "Google",
    color: "#34A853",
    description: "Latest reasoning",
    enabled: false,
  },
  {
    id: "claude-3.5-sonnet",
    name: "Claude 3.5 Sonnet",
    provider: "Anthropic",
    color: "#D97706",
    description: "Best for writing",
    enabled: false,
  },
  {
    id: "claude-3-haiku",
    name: "Claude 3 Haiku",
    provider: "Anthropic",
    color: "#F59E0B",
    description: "Ultra-fast Claude",
    enabled: false,
  },
  {
    id: "gpt-4o",
    name: "GPT-4o",
    provider: "OpenAI",
    color: "#10B981",
    description: "Flagship GPT",
    enabled: false,
  },
  {
    id: "gpt-4o-mini",
    name: "GPT-4o Mini",
    provider: "OpenAI",
    color: "#6EE7B7",
    description: "Fast & cheap",
    enabled: false,
  },
  {
    id: "mistral-7b",
    name: "Mistral 7B",
    provider: "Mistral",
    color: "#8B5CF6",
    description: "Open source",
    enabled: false,
  },
  {
    id: "llama-3.1-70b",
    name: "Llama 3.1 70B",
    provider: "Meta",
    color: "#EC4899",
    description: "Open source giant",
    enabled: false,
  },
];

interface ModelSidebarProps {
  activeModel: string;
  onModelChange: (modelId: string) => void;
  thinkingModel?: string | null;
}

export const ModelSidebar = ({
  activeModel,
  onModelChange,
  thinkingModel,
}: ModelSidebarProps) => {
  const [collapsed, setCollapsed] = useState(false);
  const [models, setModels] = useState<AIModel[]>(DEFAULT_MODELS);

  const toggleEnabled = (id: string) => {
    setModels((prev) =>
      prev.map((m) => (m.id === id ? { ...m, enabled: !m.enabled } : m))
    );
  };

  const enabledModels = models.filter((m) => m.enabled || m.id === activeModel);

  return (
    <aside
      className="flex flex-col h-full transition-all duration-300 select-none"
      style={{
        width: collapsed ? "56px" : "220px",
        background: "rgba(5,5,15,0.95)",
        borderRight: "1px solid rgba(0,163,255,0.08)",
        backdropFilter: "blur(16px)",
      }}
    >
      {/* Header */}
      <div
        className="flex items-center justify-between px-3 py-4"
        style={{ borderBottom: "1px solid rgba(0,163,255,0.08)" }}
      >
        {!collapsed && (
          <div className="flex items-center gap-2">
            <Cpu className="w-4 h-4" style={{ color: "#00A3FF" }} />
            <span
              className="text-xs font-bold uppercase tracking-widest"
              style={{ color: "#00A3FF" }}
            >
              Models
            </span>
          </div>
        )}
        <button
          onClick={() => setCollapsed((c) => !c)}
          className="ml-auto p-1 rounded transition-colors hover:bg-white/5"
          style={{ color: "rgba(255,255,255,0.3)" }}
          title={collapsed ? "Expand sidebar" : "Collapse sidebar"}
        >
          {collapsed ? (
            <ChevronRight className="w-4 h-4" />
          ) : (
            <ChevronLeft className="w-4 h-4" />
          )}
        </button>
      </div>

      {/* Model List */}
      <div className="flex-1 overflow-y-auto py-3 space-y-1 px-2">
        {models.map((model) => {
          const isActive = model.id === activeModel;
          const isThinking = model.id === thinkingModel;

          return (
            <div
              key={model.id}
              className="rounded-lg transition-all duration-150 cursor-pointer"
              style={{
                background: isActive
                  ? `${model.color}18`
                  : "transparent",
                border: isActive
                  ? `1px solid ${model.color}40`
                  : "1px solid transparent",
              }}
              onClick={() => {
                if (!model.enabled && !isActive) {
                  toggleEnabled(model.id);
                }
                onModelChange(model.id);
              }}
            >
              <div className="flex items-center gap-2 px-2 py-2">
                {/* Status Light */}
                <div className="relative flex-shrink-0">
                  <div
                    className="w-2 h-2 rounded-full"
                    style={{
                      background: isThinking
                        ? "#00A3FF"
                        : isActive
                        ? model.color
                        : model.enabled
                        ? "#22C55E"
                        : "rgba(255,255,255,0.15)",
                      boxShadow: isThinking
                        ? `0 0 8px #00A3FF`
                        : isActive
                        ? `0 0 6px ${model.color}`
                        : model.enabled
                        ? "0 0 4px #22C55E"
                        : "none",
                    }}
                  />
                  {isThinking && (
                    <div
                      className="absolute inset-0 rounded-full animate-ping"
                      style={{ background: "#00A3FF", opacity: 0.4 }}
                    />
                  )}
                </div>

                {!collapsed && (
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center justify-between gap-1">
                      <span
                        className="text-xs font-semibold truncate"
                        style={{
                          color: isActive
                            ? model.color
                            : "rgba(255,255,255,0.75)",
                        }}
                      >
                        {model.name}
                      </span>
                      {isThinking && (
                        <Zap
                          className="w-3 h-3 flex-shrink-0 animate-pulse"
                          style={{ color: "#00A3FF" }}
                        />
                      )}
                    </div>
                    <div className="flex items-center justify-between mt-0.5">
                      <span
                        className="text-[10px] truncate"
                        style={{ color: "rgba(255,255,255,0.3)" }}
                      >
                        {model.description}
                      </span>
                      {/* Toggle */}
                      <button
                        onClick={(e) => {
                          e.stopPropagation();
                          toggleEnabled(model.id);
                        }}
                        className="flex-shrink-0 w-6 h-3.5 rounded-full transition-all duration-200 relative"
                        style={{
                          background:
                            model.enabled || isActive
                              ? model.color
                              : "rgba(255,255,255,0.1)",
                        }}
                        title={model.enabled ? "Disable model" : "Enable model"}
                      >
                        <div
                          className="absolute top-0.5 w-2.5 h-2.5 rounded-full bg-white transition-all duration-200"
                          style={{
                            left:
                              model.enabled || isActive ? "10px" : "2px",
                          }}
                        />
                      </button>
                    </div>
                  </div>
                )}
              </div>
            </div>
          );
        })}
      </div>

      {/* Footer — provider legend */}
      {!collapsed && (
        <div
          className="px-3 py-3 text-[10px]"
          style={{
            borderTop: "1px solid rgba(0,163,255,0.08)",
            color: "rgba(255,255,255,0.2)",
          }}
        >
          Powered by OpenRouter
          <br />
          <span style={{ color: "rgba(0,163,255,0.5)" }}>
            Set OPENROUTER_API_KEY in Supabase
          </span>
        </div>
      )}
    </aside>
  );
};

export default ModelSidebar;
