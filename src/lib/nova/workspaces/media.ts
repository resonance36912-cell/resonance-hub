export function planMediaWorkflow(input: { project_id: string; intent: string }) {
  return { project_id: input.project_id, intent: input.intent,
    steps: [
      { kind: "storyboard", capability_id: "capability.storyboard.generate" },
      { kind: "image", capability_id: "capability.image.generate" },
      { kind: "video", capability_id: "capability.video.generate" },
    ] };
}
