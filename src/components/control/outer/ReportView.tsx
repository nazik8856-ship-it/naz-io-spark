// Outer Control: a finished multi-tool result, designed: an opinions report, a comparison, a fact-check or a rewrite. The words
// are the stored result word for word; this only lays them out.
import { ShieldCheck, Layers, Scale, Sparkles, Quote, CalendarClock, Fingerprint, Table2, ListChecks, PenLine, Wand2, ListOrdered, HelpCircle, AlertTriangle, CheckCircle2 } from "lucide-react";
import { fingerprint, kindMethod, kindOf, KIND_BADGE, KIND_NOUN, VERDICT_LABEL, when, type ReportDoc } from "@/lib/outer-control-report-doc";

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

const Bullets = ({ items, empty, dot }: { items: string[]; empty: string; dot: string }) => (
  <ul className="space-y-2 text-sm text-slate-100">
    {(items.length ? items : [empty]).map((x, i) => <li key={i} className="flex gap-2"><span className={`mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full ${dot}`} aria-hidden />{x}</li>)}
  </ul>
);

const VERDICT_TONE: Record<string, string> = {
  supported: "border-emerald-400/40 bg-emerald-400/10 text-emerald-200",
  "partly supported": "border-amber-400/40 bg-amber-400/10 text-amber-200",
  "not supported": "border-rose-400/40 bg-rose-400/10 text-rose-200",
  "cannot be verified": "border-white/20 bg-white/5 text-slate-200",
};

export default function ReportView({ doc }: { doc: ReportDoc }) {
  const n = doc.opinions.length;
  const kind = kindOf(doc);
  const toolOf = (n: number) => doc.opinions.find((o) => o.n === n)?.tool ?? "tool";
  const sources = (title: string) => (
    <Section title={title} icon={<Quote className="h-3.5 w-3.5" />} testid="report-opinions">
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
  );
  const agreeDiffer = (
    <div className="grid gap-4 md:grid-cols-2">
      <Section title="Where they agree" icon={<ShieldCheck className="h-3.5 w-3.5" />} tone="emerald" testid="report-agree">
        <Bullets items={doc.agreements} empty="No shared points were identified." dot="bg-emerald-400" />
      </Section>
      <Section title="Where they differ" icon={<Scale className="h-3.5 w-3.5" />} tone="amber" testid="report-differ">
        <Bullets items={doc.differences} empty="No differences were identified." dot="bg-amber-400" />
      </Section>
    </div>
  );
  const conclusion = (
    <section className="rounded-2xl border border-cyan-300/40 bg-gradient-to-br from-cyan-400/15 to-blue-500/10 p-4 sm:p-5" data-testid="report-conclusion">
      <h3 className="font-mono text-[11px] uppercase tracking-[0.16em] text-cyan-200">Conclusion</h3>
      <div className="mt-2 text-white"><Paras text={doc.conclusion} /></div>
    </section>
  );
  const summary = (
    <section className="rounded-2xl border border-cyan-400/20 border-l-4 border-l-cyan-400 bg-cyan-400/[0.06] p-4 sm:p-5" data-testid="report-summary">
      <h3 className="flex items-center gap-2 font-mono text-[11px] uppercase tracking-[0.16em] text-cyan-300"><Sparkles className="h-3.5 w-3.5" />Summary</h3>
      <div className="mt-2 text-slate-100"><Paras text={doc.summary} /></div>
    </section>
  );

  return (
    <div className="relative overflow-hidden rounded-2xl border border-cyan-400/25 bg-[#050b18] p-4 sm:p-6" data-testid="report-view" data-kind={kind}>
      <div className="pointer-events-none absolute -left-24 -top-24 h-72 w-72 rounded-full bg-cyan-500/20 blur-[90px]" aria-hidden />
      <div className="pointer-events-none absolute -right-28 top-10 h-72 w-72 rounded-full bg-blue-600/20 blur-[100px]" aria-hidden />
      <div className="relative space-y-4">
        <header>
          <span className="inline-flex items-center gap-1.5 rounded-full border border-cyan-300/40 bg-cyan-400/10 px-3 py-1 font-mono text-[10px] tracking-[0.2em] text-cyan-200">
            <ShieldCheck className="h-3 w-3" /> {KIND_BADGE[kind]}
          </span>
          <h2 className="mt-3 text-xl font-semibold leading-snug text-white sm:text-2xl" data-testid="report-title">{doc.topic}</h2>
          <div className="mt-3 flex flex-wrap gap-2 text-[11px] text-slate-300">
            <span className="inline-flex items-center gap-1.5 rounded-full border border-white/10 bg-white/5 px-2.5 py-1"><CalendarClock className="h-3 w-3 text-cyan-300" />{when(doc.compiled_at)}</span>
            <span className="inline-flex items-center gap-1.5 rounded-full border border-white/10 bg-white/5 px-2.5 py-1"><Layers className="h-3 w-3 text-cyan-300" />{n} source{n === 1 ? "" : "s"}</span>
            <span className="inline-flex items-center gap-1.5 rounded-full border border-emerald-400/30 bg-emerald-400/10 px-2.5 py-1 text-emerald-200"><ShieldCheck className="h-3 w-3" />Every answer rule-checked</span>
          </div>
        </header>

        {kind === "rewrite" || kind === "roles" || kind === "adapt" ? (
          <>
            <Section title={kind === "rewrite" ? "Original" : kind === "roles" ? "Question" : "Message"} icon={<PenLine className="h-3.5 w-3.5" />} testid="report-original">
              <div className="text-slate-200"><Paras text={doc.original ?? doc.topic} /></div>
            </Section>
            <Section title={kind === "rewrite" ? "Rewritten versions" : kind === "roles" ? "Answers by role" : "Adapted versions"} icon={<Wand2 className="h-3.5 w-3.5" />} testid="report-versions">
              <ul className="space-y-3">
                {(doc.versions ?? []).map((v, i) => (
                  <li key={i} className="rounded-xl border border-white/10 bg-black/20 p-3" data-testid="report-version">
                    <div className="flex flex-wrap items-baseline gap-2">
                      <span className="rounded-full border border-cyan-400/40 bg-cyan-400/10 px-2.5 py-0.5 text-xs font-medium text-cyan-100">{kind === "roles" ? `Role: ${v.style}` : kind === "adapt" ? `For: ${v.style}` : v.style}</span>
                      <span className="text-[11px] text-slate-400">by {toolOf(v.n)} [{v.n}]</span>
                    </div>
                    <div className="mt-2 text-slate-100"><Paras text={v.text} /></div>
                  </li>
                ))}
              </ul>
            </Section>
          </>
        ) : kind === "explain" || kind === "keypoints" ? (
          <>
            <Section title="Original" icon={<PenLine className="h-3.5 w-3.5" />} testid="report-original">
              <div className="text-slate-300"><Paras text={doc.original ?? doc.topic} /></div>
            </Section>
            <section className="rounded-2xl border border-cyan-400/20 border-l-4 border-l-cyan-400 bg-cyan-400/[0.06] p-4 sm:p-5" data-testid="report-output">
              <h3 className="flex items-center gap-2 font-mono text-[11px] uppercase tracking-[0.16em] text-cyan-300"><Sparkles className="h-3.5 w-3.5" />{kind === "explain" ? "Simple explanation" : "Key points"} <span className="normal-case tracking-normal text-slate-400">— by {toolOf(doc.opinions[0]?.n ?? 1)}</span></h3>
              <div className="mt-2 text-slate-100">{kind === "explain" ? <Paras text={doc.output ?? ""} /> : <Bullets items={doc.points ?? []} empty="No key points were given." dot="bg-cyan-400" />}</div>
            </section>
          </>
        ) : kind === "draft" ? (
          <>
            <section className="rounded-2xl border border-cyan-400/20 border-l-4 border-l-cyan-400 bg-cyan-400/[0.06] p-4 sm:p-5" data-testid="report-output">
              <h3 className="flex items-center gap-2 font-mono text-[11px] uppercase tracking-[0.16em] text-cyan-300"><CheckCircle2 className="h-3.5 w-3.5" />Final version</h3>
              <div className="mt-2 text-slate-100"><Paras text={doc.output ?? ""} /></div>
            </section>
            <p className="text-xs text-slate-400" data-testid="report-draft-credit">Drafted by {doc.opinions[0]?.tool ?? "tool"} [{doc.opinions[0]?.n ?? 1}], improved by {doc.opinions[doc.opinions.length - 1]?.tool ?? "tool"} [{doc.opinions[doc.opinions.length - 1]?.n ?? 2}]. The draft is kept in the Task's proof.</p>
          </>
        ) : kind === "alternatives" || kind === "multistep" || kind === "delegate" ? (
          <>
            {kind !== "alternatives" && summary}
            <Section title={kind === "alternatives" ? "Options" : kind === "multistep" ? "Steps" : "Parts"} icon={<ListOrdered className="h-3.5 w-3.5" />} testid="report-items">
              <ol className="space-y-3">
                {(doc.items ?? []).map((it, i) => (
                  <li key={i} className="rounded-xl border border-white/10 bg-black/20 p-3" data-testid="report-item">
                    <div className="flex flex-wrap items-baseline gap-2">
                      <span className="text-sm font-semibold text-white">{kind === "alternatives" ? "Option" : kind === "multistep" ? "Step" : "Part"} {i + 1}: {it.label}</span>
                      <span className="text-[11px] text-slate-400">by {toolOf(it.n)} [{it.n}]</span>
                    </div>
                    <div className="mt-2 text-slate-100"><Paras text={it.text} /></div>
                  </li>
                ))}
              </ol>
            </Section>
            {kind !== "alternatives" && (
              <section className="rounded-2xl border border-cyan-300/40 bg-gradient-to-br from-cyan-400/15 to-blue-500/10 p-4 sm:p-5" data-testid="report-output">
                <h3 className="font-mono text-[11px] uppercase tracking-[0.16em] text-cyan-200">{kind === "multistep" ? "Solution" : "Final result"}</h3>
                <div className="mt-2 text-white"><Paras text={doc.output ?? ""} /></div>
              </section>
            )}
          </>
        ) : kind === "decision" ? (
          <>
            {summary}
            <Section title="Options" icon={<Table2 className="h-3.5 w-3.5" />} testid="report-decision">
              <div className="grid gap-3 md:grid-cols-2">
                {(doc.decision ?? []).map((o, i) => (
                  <div key={i} className="rounded-xl border border-white/10 bg-black/20 p-3" data-testid="report-option">
                    <div className="text-sm font-semibold text-white">{o.option}</div>
                    <div className="mt-2 text-[11px] uppercase tracking-wider text-emerald-300">Pros</div>
                    <Bullets items={o.pros} empty="None given." dot="bg-emerald-400" />
                    <div className="mt-2 text-[11px] uppercase tracking-wider text-amber-300">Cons</div>
                    <Bullets items={o.cons} empty="None given." dot="bg-amber-400" />
                  </div>
                ))}
              </div>
            </Section>
            <section className="rounded-2xl border border-cyan-300/40 bg-gradient-to-br from-cyan-400/15 to-blue-500/10 p-4 sm:p-5" data-testid="report-conclusion">
              <h3 className="font-mono text-[11px] uppercase tracking-[0.16em] text-cyan-200">Recommendation</h3>
              <div className="mt-2 text-white"><Paras text={doc.conclusion} /></div>
            </section>
            <Section title="Risks" icon={<AlertTriangle className="h-3.5 w-3.5" />} tone="amber" testid="report-risks">
              <Bullets items={doc.risks ?? []} empty="No risks were named." dot="bg-amber-400" />
            </Section>
            {sources("Answers by source")}
          </>
        ) : kind === "research" ? (
          <>
            {summary}
            <div className="grid gap-4 md:grid-cols-2">
              <Section title="Key points" icon={<ListChecks className="h-3.5 w-3.5" />} tone="emerald" testid="report-points">
                <Bullets items={doc.points ?? []} empty="No key points were given." dot="bg-emerald-400" />
              </Section>
              <Section title="Open questions" icon={<HelpCircle className="h-3.5 w-3.5" />} tone="amber" testid="report-open">
                <Bullets items={doc.open_questions ?? []} empty="No open questions were named." dot="bg-amber-400" />
              </Section>
            </div>
            {sources("Answers by source")}
            {conclusion}
          </>
        ) : kind === "factcheck" ? (
          <>
            <section className="rounded-2xl border border-cyan-400/20 border-l-4 border-l-cyan-400 bg-cyan-400/[0.06] p-4 sm:p-5" data-testid="report-verdict">
              <h3 className="font-mono text-[11px] uppercase tracking-[0.16em] text-cyan-300">Verdict</h3>
              <span className={`mt-2 inline-block rounded-full border px-3 py-1 text-sm font-semibold ${VERDICT_TONE[doc.verdict ?? "cannot be verified"]}`}>{VERDICT_LABEL[doc.verdict ?? "cannot be verified"]}</span>
              <div className="mt-2 text-slate-100"><Paras text={doc.summary} /></div>
            </section>
            <div className="grid gap-4 md:grid-cols-2">
              <Section title="Findings" icon={<ListChecks className="h-3.5 w-3.5" />} testid="report-findings">
                <Bullets items={doc.findings ?? []} empty="No findings were given." dot="bg-cyan-400" />
              </Section>
              <Section title="Corrections" icon={<PenLine className="h-3.5 w-3.5" />} tone="amber" testid="report-corrections">
                <Bullets items={doc.corrections ?? []} empty="No corrections were needed." dot="bg-amber-400" />
              </Section>
            </div>
            {sources("Answers by source")}
            {conclusion}
          </>
        ) : kind === "compare" ? (
          <>
            {summary}
            <Section title="Side by side" icon={<Table2 className="h-3.5 w-3.5" />} testid="report-comparison">
              <div className="overflow-x-auto">
                <table className="w-full min-w-[480px] border-collapse text-left text-sm">
                  <thead>
                    <tr className="text-[11px] uppercase tracking-wider text-cyan-200">
                      <th className="border-b border-white/10 py-2 pr-3 font-medium">Aspect</th>
                      {doc.opinions.map((o) => <th key={o.n} className="border-b border-white/10 px-3 py-2 font-medium">[{o.n}] {o.tool}</th>)}
                    </tr>
                  </thead>
                  <tbody>
                    {(doc.comparison ?? []).map((r, i) => (
                      <tr key={i} className="align-top">
                        <th className="border-b border-white/5 py-2 pr-3 font-medium text-white">{r.aspect}</th>
                        {r.points.map((p, j) => <td key={j} className="border-b border-white/5 px-3 py-2 text-slate-200">{p}</td>)}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </Section>
            {sources("Answers by source")}
            {agreeDiffer}
            {conclusion}
          </>
        ) : (
          <>
            {summary}
            {sources("Opinions by source")}
            {agreeDiffer}
            {conclusion}
          </>
        )}

        <p className="rounded-xl border border-white/10 bg-white/[0.03] p-3 text-[11px] leading-relaxed text-slate-400" data-testid="report-method"><span className="font-mono uppercase tracking-wider text-slate-300">How this {KIND_NOUN[kind]} was made · </span>{kindMethod(doc)}</p>
      </div>
    </div>
  );
}
