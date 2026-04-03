import { Terminal as TerminalIcon } from "lucide-react";
import Terminal from "./components/Terminal"; // Ensure this path matches your folder!

const App = () => {
  return (
    <div className="min-h-screen bg-black text-[#00FF41] font-mono p-4 flex flex-col items-center justify-center">
      {/* Header Area */}
      <div className="w-full max-w-4xl mb-4 flex items-center justify-between border-b border-[#00FF41]/30 pb-2">
        <div className="flex items-center gap-2">
          <TerminalIcon className="w-6 h-6 animate-pulse" />
          <span className="text-xl font-bold tracking-tighter">NAZAI.TERMINAL_CORE</span>
        </div>
        <div className="text-xs opacity-50 uppercase tracking-widest">
          Status: <span className="text-green-400">System_Active</span>
        </div>
      </div>

      {/* The Main Terminal Window */}
      <main className="w-full max-w-4xl h-[70vh] border border-[#00FF41]/20 rounded-lg overflow-hidden shadow-[0_0_20px_rgba(0,255,65,0.1)]">
        <Terminal />
      </main>

      {/* Footer */}
      <footer className="mt-4 text-[10px] opacity-30 text-center uppercase">
        NazAI v2.0 // Sumy Architect Division // 2026
      </footer>
    </div>
  );
};

export default App;
