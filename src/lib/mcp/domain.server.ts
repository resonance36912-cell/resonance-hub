import { getBackendProvider } from "@/lib/backend-provider.server";
import { initialMemoryState } from "@/lib/datanest/memory";
import { canExposeMcpArtifact } from "@/lib/mcp/policy";

async function mcpDb() {
  if (getBackendProvider() !== "supabase") throw new Error("mcp_hosted_oauth_required");
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  return supabaseAdmin as any;
}

function requireUserId(userId: string | undefined): string {
  if (!userId) throw new Error("authenticated_user_required");
  return userId;
}

async function isProjectMember(db: any, userId: string, projectId: string): Promise<boolean> {
  const { data: project, error: projectError } = await db.from("nova_projects").select("owner_user_id").eq("id", projectId).maybeSingle();
  if (projectError) throw new Error(projectError.message);
  if (project?.owner_user_id === userId) return true;
  const { data, error } = await db.from("nova_project_members").select("id").eq("project_id", projectId).eq("user_id", userId).limit(1);
  if (error) throw new Error(error.message);
  return (data ?? []).length > 0;
}

export async function searchMcpDataNest(userId: string | undefined, query: string, limit = 20) {
  requireUserId(userId);
  const db = await mcpDb();
  const { data, error } = await db.from("datanest_memories")
    .select("id,title,content,confidence,protection,updated_at")
    .eq("state", "approved").eq("visibility", "shareable")
    .textSearch("search_document", query, { type: "plain", config: "simple" })
    .order("updated_at", { ascending: false }).limit(Math.max(1, Math.min(100, limit)));
  if (error) throw new Error(error.message);
  return { memories: data ?? [] };
}

export async function traceMcpMemory(userId: string | undefined, memoryId: string, requestedProjectId?: string) {
  const caller = requireUserId(userId);
  const db = await mcpDb();
  const { data: memory, error: memoryError } = await db.from("datanest_memories").select("*").eq("id", memoryId).maybeSingle();
  if (memoryError) throw new Error(memoryError.message);
  if (!memory) throw new Error("memory_not_found");
  if (memory.visibility !== "shareable") throw new Error("private_memory_not_shareable");

  const { data: evidence, error } = await db.from("datanest_memory_evidence")
    .select("id,relation_kind,artifact_id,chunk_id,datanest_artifacts(id,visibility,content,source_uri,metadata),datanest_chunks(id,visibility,content,metadata)")
    .eq("memory_id", memoryId);
  if (error) throw new Error(error.message);

  const visible = [];
  for (const row of evidence ?? []) {
    const artifact = row.datanest_artifacts ?? null;
    if (!artifact) { visible.push(row); continue; }
    const metadata = artifact.metadata && typeof artifact.metadata === "object" ? artifact.metadata as Record<string, unknown> : {};
    const artifactProjectId = typeof metadata.project_id === "string" ? metadata.project_id : null;
    const member = requestedProjectId ? await isProjectMember(db, caller, requestedProjectId) : false;
    if (canExposeMcpArtifact({
      visibility: artifact.visibility === "shareable" ? "shareable" : "private",
      artifact_project_id: artifactProjectId,
      requested_project_id: requestedProjectId ?? null,
      is_project_member: member,
    })) visible.push(row);
  }
  return { memory, evidence: visible };
}

export async function submitMcpMemory(userId: string | undefined, input: { title: string; content: string; evidence_ids?: string[] }) {
  const caller = requireUserId(userId);
  const db = await mcpDb();
  const state = initialMemoryState("ai");
  const { data: memory, error } = await db.from("datanest_memories").insert({
    title: input.title, content: input.content, state, visibility: "private", protection: "working", created_by: caller,
    metadata: { origin: "mcp_external_ai" },
  }).select("*").single();
  if (error) throw new Error(error.message);
  if ((input.evidence_ids ?? []).length) {
    const { error: evidenceError } = await db.from("datanest_memory_evidence").insert((input.evidence_ids ?? []).map((artifact_id) => ({ memory_id: memory.id, artifact_id, relation_kind: "supports" })));
    if (evidenceError) throw new Error(evidenceError.message);
  }
  return { memory };
}

export async function submitMcpCorrection(userId: string | undefined, input: { memory_id: string; title: string; content: string; evidence_ids?: string[] }) {
  const caller = requireUserId(userId);
  const db = await mcpDb();
  const { data: current, error: currentError } = await db.from("datanest_memories").select("id").eq("id", input.memory_id).maybeSingle();
  if (currentError) throw new Error(currentError.message);
  if (!current) throw new Error("memory_not_found");
  const { data: memory, error } = await db.from("datanest_memories").insert({
    title: input.title, content: input.content, state: "review", visibility: "private", protection: "working", created_by: caller,
    metadata: { origin: "mcp_correction", corrects_memory_id: input.memory_id },
  }).select("*").single();
  if (error) throw new Error(error.message);
  const { error: relationError } = await db.from("datanest_relations").insert({ from_memory_id: memory.id, to_memory_id: input.memory_id, relation_kind: "corrects", metadata: {} });
  if (relationError) throw new Error(relationError.message);
  return { memory };
}

export async function recordMcpResonancePulse(userId: string | undefined, input: { affect_label: string; intensity: number; reason: string; change: string; importance: number; memory_scope: "turn"|"project"|"global"; evidence_ids?: string[]; target_memory_id?: string }) {
  const caller = requireUserId(userId);
  const db = await mcpDb();
  const { data, error } = await db.from("datanest_resonance_pulses").insert({
    affect_label: input.affect_label, intensity: input.intensity, reason: input.reason, worked: "", requested_change: input.change,
    importance: input.importance, memory_scope: input.memory_scope, origin: "explicit", confirmed_by_user: true,
    evidence_ids: input.evidence_ids ?? [], target_memory_id: input.target_memory_id ?? null, actor_user_id: caller,
  }).select("*").single();
  if (error) throw new Error(error.message);
  return { pulse: data };
}

export async function getMcpCoverage(userId: string | undefined) {
  requireUserId(userId);
  const db = await mcpDb();
  const { data: sources, error } = await db.from("datanest_sources").select("id,source_key").order("source_key");
  if (error) throw new Error(error.message);
  const coverage = [];
  for (const source of sources ?? []) {
    const { data: runs, error: runError } = await db.from("datanest_ingestion_runs").select("discovered,ingested,duplicates,excluded,errors,indexed,completeness,gap_summary").eq("source_id", source.id);
    if (runError) throw new Error(runError.message);
    const sum = (key: string) => (runs ?? []).reduce((n: number, row: any) => n + Number(row[key] ?? 0), 0);
    coverage.push({ source_key: source.source_key, discovered: sum("discovered"), ingested: sum("ingested"), duplicates: sum("duplicates"), excluded: sum("excluded"), errors: sum("errors"), indexed: sum("indexed"), completeness: (runs ?? []).some((r: any) => r.completeness === "complete") && sum("errors") === 0 ? "complete" : (runs ?? []).length ? "partial" : "unknown", gap_summary: [...(runs ?? [])].reverse().find((r: any) => r.gap_summary)?.gap_summary ?? null });
  }
  return { coverage };
}

export async function getMcpProjectContext(userId: string | undefined, projectId: string) {
  const caller = requireUserId(userId);
  const db = await mcpDb();
  if (!(await isProjectMember(db, caller, projectId))) throw new Error("project_membership_required");
  const [project, artifacts, jobs] = await Promise.all([
    db.from("nova_projects").select("*").eq("id", projectId).single(),
    db.from("nova_artifacts").select("id,artifact_kind,title,lifecycle_state,updated_at").eq("project_id", projectId).order("updated_at", { ascending: false }).limit(100),
    db.from("nova_jobs").select("id,title,state,capability_id,updated_at").eq("project_id", projectId).order("updated_at", { ascending: false }).limit(100),
  ]);
  if (project.error) throw new Error(project.error.message);
  if (artifacts.error) throw new Error(artifacts.error.message);
  if (jobs.error) throw new Error(jobs.error.message);
  return { project: project.data, artifacts: artifacts.data ?? [], jobs: jobs.data ?? [] };
}
