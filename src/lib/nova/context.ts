export type NovaContextSectionKind =
  | "governance"
  | "project_decisions"
  | "memories"
  | "artifacts"
  | "operations"
  | "conversation"
  | "evidence";

export type NovaContextItem = Record<string, unknown> & {
  id?: string;
  project_id?: string | null;
  visibility?: string;
  state?: string;
};

export type NovaContextInput = {
  project_id: string;
  max_chars?: number;
  include_evidence?: boolean;
  governance?: NovaContextItem[];
  project_decisions?: NovaContextItem[];
  memories?: NovaContextItem[];
  artifacts?: NovaContextItem[];
  jobs?: NovaContextItem[];
  decisions?: NovaContextItem[];
  messages?: NovaContextItem[];
  evidence?: NovaContextItem[];
};

export type NovaContextResult = {
  project_id: string;
  sections: Array<{ kind: NovaContextSectionKind; items: NovaContextItem[] }>;
  provenance: Array<{ memory_id?: string; artifact_id?: string; source?: string }>;
  used_chars: number;
  truncated: boolean;
};

function inProject(item: NovaContextItem, projectId: string): boolean {
  return item.project_id == null || item.project_id === projectId;
}

export function assembleNovaContext(input: NovaContextInput): NovaContextResult {
  const maxChars = Math.max(256, Math.min(200_000, input.max_chars ?? 48_000));
  const governance = (input.governance ?? []).filter((item) => item.outcome == null || item.outcome === "approved");
  const projectDecisions = (input.project_decisions ?? []).filter(
    (item) => inProject(item, input.project_id) && item.state === "approved",
  );
  const memories = (input.memories ?? []).filter(
    (item) => item.state === "approved" && item.visibility === "shareable",
  );
  const artifacts = (input.artifacts ?? []).filter((item) => inProject(item, input.project_id));
  const jobs = (input.jobs ?? []).filter((item) => inProject(item, input.project_id));
  const decisions = (input.decisions ?? []).filter((item) => inProject(item, input.project_id));
  const messages = (input.messages ?? []).filter((item) => inProject(item, input.project_id));
  const evidence = input.include_evidence
    ? (input.evidence ?? []).filter(
        (item) => item.visibility === "shareable" || item.project_id === input.project_id,
      )
    : [];

  const ordered: Array<[NovaContextSectionKind, NovaContextItem[]]> = [
    ["governance", governance],
    ["project_decisions", projectDecisions],
    ["memories", memories],
    ["artifacts", artifacts],
    ["operations", [...jobs, ...decisions]],
    ["conversation", messages],
    ...(input.include_evidence
      ? [["evidence", evidence] as [NovaContextSectionKind, NovaContextItem[]]]
      : []),
  ];

  let used = 0;
  let truncated = false;
  const sections: NovaContextResult["sections"] = [];
  const provenance: NovaContextResult["provenance"] = [];

  for (const [kind, items] of ordered) {
    const kept: NovaContextItem[] = [];
    for (const item of items) {
      const size = JSON.stringify(item).length;
      if (used + size > maxChars) {
        truncated = true;
        continue;
      }
      kept.push(item);
      used += size;
      if (kind === "memories" && typeof item.id === "string") provenance.push({ memory_id: item.id });
      if (kind === "artifacts" && typeof item.id === "string") provenance.push({ artifact_id: item.id });
      if (kind === "evidence" && typeof item.id === "string") provenance.push({ source: "evidence:" + item.id });
    }
    sections.push({ kind, items: kept });
  }

  return { project_id: input.project_id, sections, provenance, used_chars: used, truncated };
}

export async function buildNovaContext(
  projectId: string,
  userId: string,
  options: { query?: string; include_evidence?: boolean; max_chars?: number } = {},
): Promise<NovaContextResult> {
  const { getBackendProvider } = await import("@/lib/backend-provider.server");
  if (getBackendProvider() !== "supabase") throw new Error("nova_context_hosted_backend_required");
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  const db = supabaseAdmin as any;

  const { data: project, error: projectError } = await db
    .from("nova_projects").select("id,owner_user_id").eq("id", projectId).maybeSingle();
  if (projectError) throw new Error(projectError.message);
  if (!project) throw new Error("project_not_found");
  if (project.owner_user_id !== userId) {
    const { data: member, error: memberError } = await db
      .from("nova_project_members").select("id").eq("project_id", projectId).eq("user_id", userId).maybeSingle();
    if (memberError) throw new Error(memberError.message);
    if (!member) throw new Error("project_membership_required");
  }

  let memoryQuery = db
    .from("datanest_memories")
    .select("id,title,content,state,visibility,confidence,protection,updated_at")
    .eq("state", "approved").eq("visibility", "shareable")
    .order("updated_at", { ascending: false }).limit(24);
  if (options.query?.trim()) {
    memoryQuery = memoryQuery.textSearch("search_document", options.query.trim(), { type: "plain", config: "simple" });
  }

  const [governance, projectDecisions, memories, artifacts, jobs, decisions, messages] = await Promise.all([
    db.from("governance_decisions").select("id,outcome,rationale,created_at,governance_proposals(title,summary,status)").eq("outcome", "approved").order("created_at", { ascending: false }).limit(20),
    db.from("nova_decisions").select("id,project_id,decision_text,state,resolution_reason,resolved_at").eq("project_id", projectId).eq("state", "approved").order("resolved_at", { ascending: false }).limit(30),
    memoryQuery,
    db.from("nova_artifacts").select("id,project_id,artifact_kind,title,lifecycle_state,updated_at").eq("project_id", projectId).order("updated_at", { ascending: false }).limit(80),
    db.from("nova_jobs").select("id,project_id,title,state,capability_id,metadata,updated_at").eq("project_id", projectId).not("state", "in", "(COMPLETE,FAILED)").order("updated_at", { ascending: false }).limit(50),
    db.from("nova_decisions").select("id,project_id,decision_text,state,level,expires_at,created_at").eq("project_id", projectId).eq("state", "open").order("created_at", { ascending: false }).limit(50),
    db.from("nova_messages").select("id,project_id,role,content,contributor_kind,contributor_id,created_at").eq("project_id", projectId).order("created_at", { ascending: false }).limit(40),
  ]);
  for (const result of [governance, projectDecisions, memories, artifacts, jobs, decisions, messages]) {
    if (result.error) throw new Error(result.error.message);
  }

  let evidence: NovaContextItem[] = [];
  if (options.include_evidence) {
    const { data, error } = await db
      .from("datanest_artifacts")
      .select("id,visibility,content,source_uri,metadata,created_at")
      .contains("metadata", { project_id: projectId })
      .order("created_at", { ascending: false })
      .limit(30);
    if (error) throw new Error(error.message);
    evidence = (data ?? []).map((item: Record<string, unknown>) => ({ ...item, project_id: projectId }));
  }

  return assembleNovaContext({
    project_id: projectId,
    max_chars: options.max_chars,
    include_evidence: options.include_evidence,
    governance: governance.data ?? [],
    project_decisions: projectDecisions.data ?? [],
    memories: memories.data ?? [],
    artifacts: artifacts.data ?? [],
    jobs: jobs.data ?? [],
    decisions: decisions.data ?? [],
    messages: [...(messages.data ?? [])].reverse(),
    evidence,
  });
}
