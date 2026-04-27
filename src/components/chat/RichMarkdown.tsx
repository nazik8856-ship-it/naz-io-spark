import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import MermaidDiagram from "./MermaidDiagram";

interface RichMarkdownProps {
  text: string;
}

/**
 * Premium 2026-grade Markdown renderer for NazAI chat outputs.
 *
 * Design principles:
 *  • Generous whitespace and refined typography (Inter / system stack).
 *  • Card-style code blocks and tables with subtle borders.
 *  • Theme-aware accents using CSS custom props (--nazai-accent fallback to cyan).
 *  • Mermaid diagrams render in their own styled card.
 */
const RichMarkdown = ({ text }: RichMarkdownProps) => {
  return (
    <div
      className="rich-markdown text-[13px] leading-[1.7] font-sans"
      style={{
        color: "var(--nazai-text-color, rgba(255,255,255,0.92))",
        fontFamily:
          "'Inter', ui-sans-serif, system-ui, -apple-system, 'Segoe UI', Roboto, sans-serif",
        letterSpacing: "0.005em",
      }}
    >
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        components={{
          h1: ({ children }) => (
            <h1
              className="text-[18px] font-semibold mt-5 mb-3 tracking-tight"
              style={{ color: "var(--nazai-accent, #06b6d4)" }}
            >
              {children}
            </h1>
          ),
          h2: ({ children }) => (
            <h2
              className="text-[15px] font-semibold mt-5 mb-2.5 tracking-tight"
              style={{ color: "var(--nazai-accent, #06b6d4)" }}
            >
              {children}
            </h2>
          ),
          h3: ({ children }) => (
            <h3
              className="text-[13px] font-semibold mt-4 mb-2 uppercase tracking-[0.12em]"
              style={{ color: "var(--nazai-accent-soft, rgba(6,182,212,0.85))" }}
            >
              {children}
            </h3>
          ),
          p: ({ children }) => (
            <p className="my-2.5 leading-[1.75]">{children}</p>
          ),
          strong: ({ children }) => (
            <strong className="font-semibold" style={{ color: "var(--nazai-text-strong, #ffffff)" }}>
              {children}
            </strong>
          ),
          em: ({ children }) => (
            <em className="italic" style={{ color: "var(--nazai-text-muted, rgba(255,255,255,0.75))" }}>
              {children}
            </em>
          ),
          a: ({ href, children }) => (
            <a
              href={href}
              target="_blank"
              rel="noopener noreferrer"
              className="font-medium underline-offset-2 hover:underline transition-colors"
              style={{ color: "var(--nazai-accent, #06b6d4)" }}
            >
              {children}
            </a>
          ),
          ul: ({ children }) => (
            <ul
              className="list-disc pl-6 my-3 space-y-1.5"
              style={{ color: "inherit" }}
            >
              {children}
            </ul>
          ),
          ol: ({ children }) => (
            <ol className="list-decimal pl-6 my-3 space-y-1.5">{children}</ol>
          ),
          li: ({ children }) => (
            <li className="leading-[1.65] pl-1">{children}</li>
          ),
          blockquote: ({ children }) => (
            <blockquote
              className="my-3 pl-4 py-2 italic rounded-r-md"
              style={{
                borderLeft: "3px solid var(--nazai-accent, #06b6d4)",
                background: "var(--nazai-blockquote-bg, rgba(6,182,212,0.06))",
                color: "var(--nazai-text-muted, rgba(255,255,255,0.78))",
              }}
            >
              {children}
            </blockquote>
          ),
          hr: () => (
            <hr
              className="my-5"
              style={{ borderColor: "var(--nazai-border-soft, rgba(255,255,255,0.08))" }}
            />
          ),
          // Premium tables — clean borders, subtle header tint, generous padding.
          table: ({ children }) => (
            <div
              className="my-4 overflow-x-auto rounded-xl"
              style={{
                border: "1px solid var(--nazai-border-soft, rgba(255,255,255,0.10))",
                background: "var(--nazai-table-bg, rgba(255,255,255,0.02))",
                boxShadow: "0 1px 0 0 rgba(255,255,255,0.04) inset",
              }}
            >
              <table className="w-full text-[12.5px] border-collapse">{children}</table>
            </div>
          ),
          thead: ({ children }) => (
            <thead
              style={{
                background: "var(--nazai-table-head-bg, rgba(6,182,212,0.08))",
                color: "var(--nazai-accent, #06b6d4)",
              }}
            >
              {children}
            </thead>
          ),
          tbody: ({ children }) => <tbody>{children}</tbody>,
          tr: ({ children }) => (
            <tr
              style={{
                borderBottom: "1px solid var(--nazai-border-soft, rgba(255,255,255,0.06))",
              }}
            >
              {children}
            </tr>
          ),
          th: ({ children }) => (
            <th className="text-left font-semibold uppercase tracking-[0.08em] px-4 py-2.5 text-[11px]">
              {children}
            </th>
          ),
          td: ({ children }) => (
            <td
              className="px-4 py-3 align-top leading-[1.6]"
              style={{ color: "var(--nazai-text-color, rgba(255,255,255,0.88))" }}
            >
              {children}
            </td>
          ),
          code: ({ inline, className, children, ...props }: any) => {
            const langMatch = /language-(\w+)/.exec(className || "");
            const lang = langMatch?.[1];
            const value = String(children ?? "").replace(/\n$/, "");

            if (!inline && lang === "mermaid") {
              return (
                <div
                  className="my-4 p-5 rounded-xl"
                  style={{
                    border: "1px solid var(--nazai-border-soft, rgba(255,255,255,0.10))",
                    background: "var(--nazai-card-bg-soft, rgba(255,255,255,0.03))",
                  }}
                >
                  <MermaidDiagram code={value} />
                </div>
              );
            }

            if (inline) {
              return (
                <code
                  className="px-1.5 py-0.5 rounded font-mono text-[12px]"
                  style={{
                    background: "var(--nazai-inline-code-bg, rgba(6,182,212,0.10))",
                    color: "var(--nazai-accent, #06b6d4)",
                    border: "1px solid var(--nazai-border-soft, rgba(6,182,212,0.18))",
                  }}
                  {...props}
                >
                  {children}
                </code>
              );
            }

            return (
              <pre
                className="my-3 p-4 rounded-xl overflow-x-auto"
                style={{
                  background: "var(--nazai-code-bg, rgba(2,6,23,0.7))",
                  border: "1px solid var(--nazai-border-soft, rgba(255,255,255,0.08))",
                  fontFamily: "'JetBrains Mono', ui-monospace, SFMono-Regular, Menlo, monospace",
                }}
              >
                <code
                  className={`text-[12px] leading-[1.6] ${className || ""}`}
                  style={{ color: "var(--nazai-code-fg, #e2e8f0)" }}
                  {...props}
                >
                  {children}
                </code>
              </pre>
            );
          },
        }}
      >
        {text}
      </ReactMarkdown>
    </div>
  );
};

export default RichMarkdown;
