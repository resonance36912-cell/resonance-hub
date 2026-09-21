export function planProductWorkflow(input: { project_id: string; intent: string }) {
  return { project_id: input.project_id, intent: input.intent,
    steps: ["research","specify","costing","regulatory_checklist","prototype","review","publish"].map(kind => ({ kind, capability_id: `capability.product.${kind}` })) };
}
