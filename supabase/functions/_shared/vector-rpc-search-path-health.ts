// Pure classification for cron-health-check's vector-RPC search_path
// check (see 20260906030000_vector_rpc_search_path_healthcheck.sql). No
// DB dependency, so fully unit testable -- the edge function does the
// RPC call and maps rows into this shape first.
//
// Real bug this exists to catch, permanently: search_decision_precedent,
// search_response_context, and search_response_cache were all created
// with a SECURITY DEFINER search_path that omitted `extensions`, the
// schema this project's pgvector extension actually lives in. Every
// call silently failed with "operator does not exist: extensions.vector
// <=> extensions.vector", indistinguishable from a genuine "no match"
// to every caller (each treats any RPC error as an empty result). Fixed
// once already (see the migration above); this check exists so a future
// regression -- someone recreates one of these functions without
// `extensions` in its search_path -- is caught within one 30-minute
// health-check cycle instead of silently for an unknown period again.
export type VectorRpcSearchPathRow = { functionName: string; searchPathOk: boolean };

/** Pure -- which of these functions currently have a broken search_path. */
export function findBrokenVectorRpcs(rows: VectorRpcSearchPathRow[]): string[] {
  return rows.filter((r) => !r.searchPathOk).map((r) => r.functionName).sort();
}

/** Pure -- the platform_incidents "kind" for one broken function -- one incident per function, same shape cron-health.ts uses for job names, so each can clear independently once its own fix lands. */
export function vectorRpcIncidentKind(functionName: string): string {
  return `vector_rpc_search_path:${functionName}`;
}

export function summarizeBrokenVectorRpc(functionName: string): string {
  return (
    `The "${functionName}" database function's search_path doesn't include the schema pgvector lives in ` +
    `(extensions) -- every call to it is silently failing and being treated as "no match found" by its ` +
    `caller. Fix: ALTER FUNCTION public.${functionName}(...) SET search_path = public, extensions, pg_temp ` +
    `-- match its real argument types (see pg_get_function_identity_arguments) since ALTER FUNCTION requires ` +
    `the exact signature.`
  );
}
