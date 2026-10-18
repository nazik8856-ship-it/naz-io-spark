// Outer Control: a finished report, designed. The words are the stored report word for word; this only lays them out.
import { ShieldCheck, Layers, Scale, Sparkles, Quote, CalendarClock, Fingerprint } from "lucide-react";
import { fingerprint, REPORT_METHOD, when, type ReportDoc } from "@/lib/outer-control-report-doc";

const Section = ({ title, icon, tone = "cyan", children, testid }: { title: string; icon: React.ReactNode; tone?: "cyan" | "emerald" | "amber"; children: React.ReactNode; testid?: string }) => {
  const color = tone === "emerald" ? "text-emerald-300" : tone === "amber" ? "text-amber-300" : "text-cyan-300";
  return (
    <section className="rounded-2xl border border-white/10 bg-gradient-to-b from-[#0b1a35]/80 to-[#070f22]/80 p-4 sm:p-5" data-testid={testid}>
      <h3 className={`flex items-center gap-2 font-mono text-[11px] uppercase tracking-[0.16em] ${color}`}>{icon}{title}</h3>
      <div className="mt-3">{children}</div>
    </section>
  );
};

const Paras = ({ text, className = "" }: { text: string; className?: string }) => (
  <div className="space-y-2">{text.trim().split(/\n{2,}/).map((p, i) => <p key={i} className={`whitespace-pre-wrap text-sm leading-relaxed ${className}`}>{p}</p>)}</div>
);

export default function ReportView({ doc }: { doc: ReportDoc }) {
  const n = doc.opinions.length;
  return (
    <div className="relative overflow-hidden rounded-2xl border border-cyan-400/25 bg-[#050b18] p-4 sm:p-6" data-testid="report-view">
      <div className="pointer-events-none absolute -left-24 -top-24 h-72 w-72 rounded-full bg-cyan-500/20 blur-[90px]" aria-hidden />
      <div className="pointer-events-none absolute -right-28 top-10 h-72 w-72 rounded-full bg-blue-600/20 blur-[100px]" aria-hidden />
      <div className="relative space-y-4">
        <header>
          <span className="inline-flex items-center gap-1.5 rounded-full border border-cyan-300/40 bg-cyan-400/10 px-3 py-1 font-mono text-[10px] tracking-[0.2em] text-cyan-200">
            <ShieldCheck className="h-3 w-3" /> NAZAI REPORT
          </span>
          <h2 className="mt-3 text-xl font-semibold leading-snug text-white sm:text-2xl" data-testid="report-title">{doc.topic}</h2>
          <div className="mt-3 flex flex-wrap gap-2 text-[11px] text-slate-300">
            <span className="inline-flex items-center gap-1.5 rounded-full border border-white/10 bg-white/5 px-2.5 py-1"><CalendarClock className="h-3 w-3 text-cyan-300" />{when(doc.compiled_at)}</span>
            <span className="inline-flex items-center gap-1.5 rounded-full border border-white/10 bg-white/5 px-2.5 py-1"><Layers className="h-3 w-3 text-cyan-300" />{n} source{n === 1 ? "" : "s"}</span>
            <span className="inline-flex items-center gap-1.5 rounded-full border border-emerald-400/30 bg-emerald-400/10 px-2.5 py-1 text-emerald-200"><ShieldCheck className="h-3 w-3" />Every answer rule-checked</span>
          </div>
        </header>

        <section className="rounded-2xl border border-cyan-400/20 border-l-4 border-l-cyan-400 bg-cyan-400/[0.06] p-4 sm:p-5" data-testid="report-summary">
          <h3 className="flex items-center gap-2 font-mono text-[11px] uppercase tracking-[0.16em] text-cyan-300"><Sparkles className="h-3.5 w-3.5" />Summary</h3>
          <div className="mt-2 text-slate-100"><Paras text={doc.summary} /></div>
        </section>

        <Section title="Opinions by source" icon={<Quote className="h-3.5 w-3.5" />} testid="report-opinions">
          <ul className="space-y-3">
            {doc.opinions.map((o) => (
              <li key={o.n} className="flex gap-3 rounded-xl border border-white/10 bg-black/20 p-3" data-testid="report-opinion">
                <span className="grid h-8 w-8 shrink-0 place-items-center rounded-full bg-gradient-to-br from-cyan-300 to-blue-500 text-sm font-bold text-[#04101f]">{o.n}</span>
                <div className="min-w-0">
                  <div className="text-sm font-semibold text-white">{o.tool}</div>
                  <div className="text-[11px] text-slate-400">Received {when(o.at)}</div>
                  <div className="mt-2 border-l-2 border-cyan-400/50 pl-3 text-slate-100"><Paras text={o.text} /></div>
                  {o.shortened && <p className="mt-1 text-[11px] text-slate-400">Shortened for the report; the full controlled answer is stored in its step.</p>}
                  <div className="mt-2 inline-flex items-center gap-1 font-mono text-[10px] text-slate-500"><Fingerprint className="h-3 w-3" />{fingerprint(o.sha256)}</div>
                </div>
              </li>
            ))}
          </ul>
        </Section>

        <div className="grid gap-4 md:grid-cols-2">
          <Section title="Where they agree" icon={<ShieldCheck className="h-3.5 w-3.5" />} tone="emerald" testid="report-agree">
            <ul className="space-y-2 text-sm text-slate-100">
              {(doc.agreements.length ? doc.agreements : ["No shared points were identified."]).map((x, i) => <li key={i} className="flex gap-2"><span className="mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full bg-emerald-400" aria-hidden />{x}</li>)}
            </ul>
          </Section>
          <Section title="Where they differ" icon={<Scale className="h-3.5 w-3.5" />} tone="amber" testid="report-differ">
            <ul className="space-y-2 text-sm text-slate-100">
              {(doc.differences.length ? doc.differences : ["No differences were identified."]).map((x, i) => <li key={i} className="flex gap-2"><span className="mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full bg-amber-400" aria-hidden />{x}</li>)}
            </ul>
          </Section>
        </div>

        <section className="rounded-2xl border border-cyan-300/40 bg-gradient-to-br from-cyan-400/15 to-blue-500/10 p-4 sm:p-5" data-testid="report-conclusion">
          <h3 className="font-mono text-[11px] uppercase tracking-[0.16em] text-cyan-200">Conclusion</h3>
          <div className="mt-2 text-white"><Paras text={doc.conclusion} /></div>
        </section>

        <p className="rounded-xl border border-white/10 bg-white/[0.03] p-3 text-[11px] leading-relaxed text-slate-400" data-testid="report-method"><span className="font-mono uppercase tracking-wider text-slate-300">How this report was made · </span>{REPORT_METHOD}</p>
      </div>
    </div>
  );
}
