import "./preamble.ts";
export * from "./fake-supabase.ts";
export { advanceSession, resumeSession, contactRuleStopping, applyEditedReply } from "../../supabase/functions/_shared/outer-control-session.ts";

export { driveSession, startFollowUp, startWorkflow, startTask, startGoal, acceptGoal, extendGoal, progressWorkflow, cancelWorkflow, resumeAndDrive, continueSession } from "../../supabase/functions/_shared/outer-control-workflow.ts";

export { updateToolKey, removeTool, createAgentTool, ensureReportTool } from "../../supabase/functions/_shared/outer-control-tools.ts";

export { relayToTask, taskForKey } from "../../supabase/functions/_shared/outer-control-relay.ts";

export { validateArtifact, officialOutput } from "../../supabase/functions/_shared/outer-control-artifact.ts";
export { honestStatus } from "../../supabase/functions/_shared/outer-control-status.ts";
import { buildSessionArtifact as _bsa } from "../../supabase/functions/_shared/outer-control-artifact.ts";
/** A valid session artifact for a leg the test marks completed by hand. */
export function fakeArtifact(text: string) {
  const sha = "d".repeat(64);
  const r = _bsa({ id: "x", taskId: null, objective: "o", tool: "t", completedAt: "2026-10-17T00:00:00Z", finalText: text, sha256: sha,
    checklist: { passed: true, outcome: "completed", summary: "ok", criteria: [{ id: "a", label: "a", ok: true, detail: "d" }], output_sha256: sha }, steps: [], rulesInForce: [], decidedBy: "tool" });
  if (!r.ok) throw new Error("fakeArtifact");
  return r.artifact;
}

export { runConnectionTest, describeHttpFailure, readTestReply } from "../../supabase/functions/_shared/outer-control-tool-test.ts";
export { extractLinks, describeWhatDone } from "../../supabase/functions/_shared/outer-control-artifact.ts";
export { parseToolReply } from "../../supabase/functions/_shared/outer-control-tool-request.ts";

export { writeReport, parseAnalysis, composeReport, buildAnalysisPrompt, opinionInstruction, reportInstruction, stepInstructionFor, writerInstructionFor, taskTitle, parseTaskTitle, parseCompare, parseFactcheck, parseRewriteVersions, buildComparePrompt, buildFactcheckPrompt, cleanStyles, TASK_LIMITS,
  parseVersions, parseOptions, parsePoints, buildResearchPrompt, parseResearch, buildDecisionPrompt, parseDecision, buildPlanPrompt, parsePlan, buildCombinePrompt, parseCombine, planLabel,
  routeRequest, guessKind, improveInstruction, multistepInstruction, delegateInstruction, cleanCount, HONEST_ANALYST, fence } from "../../supabase/functions/_shared/outer-control-report.ts";

export { composeReportText, isReportDoc, reportHtml } from "../../supabase/functions/_shared/outer-control-report-doc.ts";
export { buildReportDoc } from "../../supabase/functions/_shared/outer-control-report.ts";
export { checkGoal } from "../../supabase/functions/_shared/outer-control-judgement.ts";
export { validateLegs, legReadiness } from "../../supabase/functions/_shared/outer-control-workflow-plan.ts";
export { handleProjectsAction, htmlToText, githubRepoOf, notionBlocksToMarkdown, wordsToPattern, checkProjectText, projectContextFor, contentTypeOf, rulesForProject, cleanName, MAX_PROJECT_CHARS, hideBeforeSaving, scanProjectText, looksBinary, linkShapeProblem, sealLegacyProjects, projectWriteBackAllowed, PROJECT_OPEN, PROJECT_CLOSE } from "../../supabase/functions/_shared/projects.ts";
export { importProjectKey, encryptText, decryptText } from "../../supabase/functions/_shared/project-crypto.ts";
