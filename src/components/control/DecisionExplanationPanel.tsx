// Renders the full plain-English narrative (see src/lib/decision-explanation.ts)
// plus the structured gate-trace checklist underneath it. Previously the
// Control System's own pages only ever showed the raw `reasoning` string and,
// separately, the gate trace -- the same composed explanation the external
// Control API has offered third-party integrators since decision-explanation.ts
// shipped was never available to a human operator inside the app itself.
import { buildDecisionExplanation, type PrecedentCitationRecord, type ApprovalResolution, type DecisionOverride } from "@/lib/decision-explanation";
import { GateTraceList, type TraceEntry } from "@/components/control/GateTraceList";

export function DecisionExplanationPanel({
  decision, reasoning, confidenceScore, source, escalated, humanResponse,
  actionType, provider, createdAt, gateTrace, precedentCitations, approvalResolutions, overrides,
}: {
  decision: string;
  reasoning: string | null;
  confidenceScore: number | null;
  source: string | null;
  escalated: boolean;
  humanResponse: string | null;
  actionType: string | null;
  provider: string | null;
  createdAt: string;
  gateTrace: TraceEntry[] | null;
  precedentCitations: PrecedentCitationRecord | null;
  approvalResolutions?: ApprovalResolution[] | null;
  overrides?: DecisionOverride[] | null;
}) {
  const narrative = buildDecisionExplanation({
    decisionText: decision,
    reasoning,
    confidenceScore,
    source,
    escalated,
    humanResponse,
    actionType,
    provider,
    createdAt,
    gateTrace,
    precedentCitations,
    approvalResolutions,
    overrides,
  });
  return (
    <div className="mt-2 space-y-2 rounded border border-white/10 bg-black/20 p-3">
      <p className="whitespace-pre-line text-xs leading-relaxed text-zinc-300">{narrative}</p>
      {gateTrace && gateTrace.length > 0 && <GateTraceList trace={gateTrace} />}
    </div>
  );
}
