export function planContentWorkflow(input: { project_id: string; kind: string; intent: string }) {
  return { project_id: input.project_id, kind: input.kind, intent: input.intent,
    steps: ["research","outline","draft","refine","format","media","publish"].map(kind => ({ kind, capability_id: `capability.content.${kind}` })) };
}
