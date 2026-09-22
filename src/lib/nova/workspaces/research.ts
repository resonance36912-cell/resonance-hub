export function planResearchWorkflow(input: { project_id: string; intent: string }) {
  return { project_id: input.project_id, intent: input.intent,
    artifacts: [
      { kind: "research_evidence", memory_state: "draft", project_id: input.project_id },
      { kind: "knowledge", memory_state: "draft", project_id: input.project_id },
    ] };
}
