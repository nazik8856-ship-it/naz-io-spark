import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import MermaidDiagram from "./MermaidDiagram";

interface RichMarkdownProps {
  text: string;
}

/**
 * Renders an AI response as Markdown with GitHub-flavored extensions
 * (tables, task lists, strikethrough) and inline Mermaid diagrams when
 * the AI returns a fenced ```mermaid block.
 *
 * Styling stays consistent with the chat bubble: small font, cyan accents,
 * scannable spacing.
 */
const RichMarkdown = ({ text }: RichMarkdownProps) => {
  return (
    <div className="rich-markdown text-[11px] leading-relaxed text-white/80 font-sans">
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        components={{
          h1: ({ children }) => (
            <h1 className="text-sm font-bold text-cyan-300 mt-3 mb-1.5 tracking-tight">
              {children}
            </h1>
          ),
          h2: ({ children }) => (
            <h2 className="text-[12px] font-bold text-cyan-300 mt-3 mb-1.5 tracking-tight">
              {children}
            </h2>
          ),
          h3: ({ children }) => (
            <h3 className="text-[11px] font-bold text-cyan-200 mt-2.5 mb-1 uppercase tracking-wider">
              {children}
            </h3>
          ),
          p: ({ children }) => <p className="my-1.5">{children}</p>,
          strong: ({ children }) => (
            <strong className="font-bold text-white/95">{children}</strong>
          ),
          em: ({ children }) => <em className="italic text-white/85">{children}</em>,
          a: ({ href, children }) => (
            <a
              href={href}
              target="_blank"
              rel="noopener noreferrer"
              className="text-cyan-300 underline decoration-cyan-500/40 hover:decoration-cyan-300"
            >
              {children}
            </a>
          ),
          ul: ({ children }) => (
            <ul className="list-disc pl-5 my-1.5 space-y-0.5 marker:text-cyan-400">
              {children}
            </ul>
          ),
          ol: ({ children }) => (
            <ol className="list-decimal pl-5 my-1.5 space-y-0.5 marker:text-cyan-400">
              {children}
            </ol>
          ),
          li: ({ children }) => <li className="leading-snug">{children}</li>,
          blockquote: ({ children }) => (
            <blockquote className="border-l-2 border-cyan-500/60 pl-3 my-2 text-white/70 italic">
              {children}
            </blockquote>
          ),
          hr: () => <hr className="my-3 border-white/10" />,
          table: ({ children }) => (
            <div className="my-2.5 overflow-x-auto rounded-lg border border-cyan-500/20 bg-zinc-950/50">
              <table className="w-full text-[10.5px] border-collapse">{children}</table>
            </div>
          ),
          thead: ({ children }) => (
            <thead className="bg-cyan-500/10 text-cyan-200">{children}</thead>
          ),
          tbody: ({ children }) => <tbody>{children}</tbody>,
          tr: ({ children }) => (
            <tr className="border-b border-white/5 last:border-0">{children}</tr>
          ),
          th: ({ children }) => (
            <th className="text-left font-bold uppercase tracking-wider px-2.5 py-1.5 text-[10px]">
              {children}
            </th>
          ),
          td: ({ children }) => (
            <td className="px-2.5 py-1.5 align-top text-white/80">{children}</td>
          ),
          code: ({ inline, className, children, ...props }: any) => {
            const langMatch = /language-(\w+)/.exec(className || "");
            const lang = langMatch?.[1];
            const value = String(children ?? "").replace(/\n$/, "");

            if (!inline && lang === "mermaid") {
              return <MermaidDiagram code={value} />;
            }

            if (inline) {
              return (
                <code
                  className="px-1 py-0.5 rounded bg-cyan-500/10 text-cyan-200 font-mono text-[10.5px]"
                  {...props}
                >
                  {children}
                </code>
              );
            }

            return (
              <pre className="my-2 p-3 rounded-lg bg-zinc-950/80 border border-white/10 overflow-x-auto">
                <code
                  className={`font-mono text-[10.5px] text-zinc-200 ${className || ""}`}
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
