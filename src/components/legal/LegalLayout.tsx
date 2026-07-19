import { Link } from "react-router-dom";
import { ReactNode } from "react";

interface LegalLayoutProps {
  eyebrow: string;
  title: string;
  updated: string;
  children: ReactNode;
}

export const LegalLayout = ({ eyebrow, title, updated, children }: LegalLayoutProps) => {
  return (
    <div className="relative min-h-screen bg-[#020617] text-white overflow-hidden">
      {/* Ambient background */}
      <div
        aria-hidden
        className="pointer-events-none absolute inset-0 opacity-[0.15]"
        style={{
          backgroundImage:
            "linear-gradient(rgba(0,163,255,0.08) 1px, transparent 1px), linear-gradient(90deg, rgba(0,163,255,0.08) 1px, transparent 1px)",
          backgroundSize: "56px 56px",
          maskImage:
            "radial-gradient(ellipse at 50% 0%, black 0%, transparent 70%)",
        }}
      />
      <div
        aria-hidden
        className="pointer-events-none absolute -top-40 left-1/2 -translate-x-1/2 w-[900px] h-[900px] rounded-full blur-3xl"
        style={{ background: "radial-gradient(circle, rgba(0,163,255,0.18), transparent 60%)" }}
      />

      <div className="relative max-w-3xl mx-auto px-6 py-20">
        <Link
          to="/"
          className="inline-flex items-center gap-2 text-xs font-mono uppercase tracking-[0.2em] text-white/50 hover:text-[#00A3FF] transition-colors"
        >
          <span aria-hidden>←</span> Return to base
        </Link>

        <div className="mt-10">
          <div className="flex items-center gap-3 text-[10px] font-mono uppercase tracking-[0.3em] text-[#00A3FF]/80">
            <span className="w-8 h-px bg-[#00A3FF]/60" />
            <span>{eyebrow}</span>
          </div>
          <h1 className="mt-4 text-5xl md:text-6xl font-bold tracking-tight leading-[1.05]">
            {title}
          </h1>
          <p className="mt-4 text-xs font-mono uppercase tracking-widest text-white/40">
            Last updated · {updated}
          </p>
        </div>

        <div className="mt-14 relative rounded-2xl border border-white/10 bg-white/[0.02] backdrop-blur-sm p-8 md:p-12">
          <div
            aria-hidden
            className="absolute -top-px left-8 right-8 h-px"
            style={{
              background:
                "linear-gradient(90deg, transparent, rgba(0,163,255,0.6), transparent)",
            }}
          />
          <div className="space-y-10">{children}</div>
        </div>

        <div className="mt-10 flex items-center justify-between text-xs font-mono uppercase tracking-widest text-white/30">
          <Link to="/privacy" className="hover:text-[#00A3FF] transition-colors">
            · Privacy Policy
          </Link>
          <Link to="/terms" className="hover:text-[#00A3FF] transition-colors">
            Terms of Service ·
          </Link>
        </div>
      </div>
    </div>
  );
};

interface LegalSectionProps {
  index?: string;
  title: string;
  children: ReactNode;
}

export const LegalSection = ({ index, title, children }: LegalSectionProps) => (
  <section className="group">
    <div className="flex items-baseline gap-4">
      {index && (
        <span className="text-xs font-mono text-[#00A3FF]/70 tracking-widest pt-1">
          {index}
        </span>
      )}
      <h2 className="text-xl md:text-2xl font-semibold text-white tracking-tight">
        {title}
      </h2>
    </div>
    <div className="mt-3 pl-0 md:pl-10 text-white/70 leading-relaxed space-y-3">
      {children}
    </div>
  </section>
);

export const legalToday = () =>
  new Date().toLocaleDateString("en-US", {
    year: "numeric",
    month: "long",
    day: "numeric",
  });
