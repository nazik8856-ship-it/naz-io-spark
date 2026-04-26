import { useEffect, useRef, useState } from "react";
import mermaid from "mermaid";

let initialized = false;

const ensureInit = () => {
  if (initialized) return;
  mermaid.initialize({
    startOnLoad: false,
    theme: "dark",
    securityLevel: "loose",
    fontFamily: "JetBrains Mono, ui-monospace, monospace",
    themeVariables: {
      background: "transparent",
      primaryColor: "#0a0a0a",
      primaryTextColor: "#e2e8f0",
      primaryBorderColor: "#06b6d4",
      lineColor: "#06b6d4",
      secondaryColor: "#1e293b",
      tertiaryColor: "#0f172a",
    },
  });
  initialized = true;
};

interface MermaidDiagramProps {
  code: string;
}

const MermaidDiagram = ({ code }: MermaidDiagramProps) => {
  const ref = useRef<HTMLDivElement>(null);
  const [error, setError] = useState<string | null>(null);
  const [svg, setSvg] = useState<string>("");

  useEffect(() => {
    let cancelled = false;
    ensureInit();
    const id = `mmd-${Math.random().toString(36).slice(2, 10)}`;
    mermaid
      .render(id, code.trim())
      .then(({ svg }) => {
        if (!cancelled) {
          setSvg(svg);
          setError(null);
        }
      })
      .catch((err) => {
        if (!cancelled) {
          setError(err?.message || "Diagram could not be rendered");
        }
      });
    return () => {
      cancelled = true;
    };
  }, [code]);

  if (error) {
    return (
      <pre className="my-2 p-3 rounded-lg bg-zinc-900/80 border border-rose-500/40 text-[10px] font-mono text-rose-300 overflow-x-auto whitespace-pre-wrap">
        Mermaid render failed: {error}
        {"\n\n"}
        {code}
      </pre>
    );
  }

  return (
    <div
      ref={ref}
      className="my-3 p-3 rounded-xl bg-zinc-950/60 border border-cyan-500/20 overflow-x-auto"
      // eslint-disable-next-line react/no-danger
      dangerouslySetInnerHTML={{ __html: svg }}
    />
  );
};

export default MermaidDiagram;
