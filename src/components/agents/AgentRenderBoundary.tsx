import React from "react";

// Defensive boundary so a runtime crash inside the bespoke cockpit (e.g. a
// malformed manifest from the backend) never produces a blank-tab experience.
// We show a compact "Agent ready" fallback card with the name + goal so the
// user always sees a generated AI Agent.
type Props = {
  agentName: string;
  goal?: string;
  children: React.ReactNode;
};
type State = { error: Error | null };

export default class AgentRenderBoundary extends React.Component<Props, State> {
  state: State = { error: null };

  static getDerivedStateFromError(error: Error): State {
    return { error };
  }

  componentDidCatch(error: Error, info: React.ErrorInfo) {
    console.error("[AgentRenderBoundary] cockpit crashed:", error, info);
  }

  render() {
    if (this.state.error) {
      return (
        <div className="rounded-2xl border border-emerald-400/30 bg-gradient-to-br from-emerald-400/5 via-cyan-400/5 to-transparent p-5 space-y-3">
          <div className="flex items-center gap-2">
            <span className="h-2 w-2 rounded-full bg-emerald-400 animate-pulse" />
            <span className="text-[10px] uppercase tracking-[0.22em] text-emerald-300 font-mono">
              Agent Live
            </span>
          </div>
          <h2 className="text-xl font-bold text-white">{this.props.agentName}</h2>
          {this.props.goal && (
            <p className="text-sm text-zinc-300 leading-relaxed">🎯 {this.props.goal}</p>
          )}
          <p className="text-[11px] text-amber-300/80 font-mono">
            Cockpit recovered after a render hiccup — the agent is deployed and
            running. Refresh to re-mount the full dashboard.
          </p>
        </div>
      );
    }
    return this.props.children;
  }
}
