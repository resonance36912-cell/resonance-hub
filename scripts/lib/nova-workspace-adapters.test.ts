import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";

const content = await import("../../src/lib/nova/workspaces/content").catch(() => null);
const products = await import("../../src/lib/nova/workspaces/products").catch(() => null);
const media = await import("../../src/lib/nova/workspaces/media").catch(() => null);
const research = await import("../../src/lib/nova/workspaces/research").catch(() => null);
const brand = await import("../../src/lib/nova/workspaces/brand").catch(() => null);
const contracts = await import("../../src/lib/nova/workspaces/contracts").catch(() => null);

describe("Nova unified workspace planners", () => {
  test("content follows the governed end-to-end publishing lifecycle", () => {
    expect(content).not.toBeNull();
    if (!content) return;
    const plan = content.planContentWorkflow({
      project_id: "22222222-2222-4222-8222-222222222222",
      kind: "course",
      intent: "Turn the supplied material into a training course",
    });
    expect(plan.steps.map((step: { kind: string }) => step.kind)).toEqual([
      "research", "outline", "draft", "refine", "format", "media", "publish",
    ]);
    expect(plan.steps.every((step: { capability_id?: string }) => typeof step.capability_id === "string")).toBe(true);
    expect(plan).not.toHaveProperty("provider_calls");
  });

  test("products include costing and regulatory review without restoring payments", () => {
    expect(products).not.toBeNull();
    if (!products) return;
    const plan = products.planProductWorkflow({
      project_id: "22222222-2222-4222-8222-222222222222",
      intent: "Develop a new consumer product",
    });
    expect(plan.steps.map((step: { kind: string }) => step.kind)).toContain("costing");
    expect(plan.steps.map((step: { kind: string }) => step.kind)).toContain("regulatory_checklist");
    expect(JSON.stringify(plan)).not.toContain("payments");
  });

  test("research creates evidence and draft knowledge, never approved canon automatically", () => {
    expect(research).not.toBeNull();
    if (!research) return;
    const plan = research.planResearchWorkflow({
      project_id: "22222222-2222-4222-8222-222222222222",
      intent: "Research sustainable packaging",
    });
    expect(plan.artifacts.some((artifact: { kind: string }) => artifact.kind === "research_evidence")).toBe(true);
    expect(plan.artifacts.some((artifact: { memory_state?: string }) => artifact.memory_state === "draft")).toBe(true);
    expect(plan.artifacts.some((artifact: { memory_state?: string }) => artifact.memory_state === "approved")).toBe(false);
  });

  test("media routes through capability IDs rather than hardcoded provider calls", () => {
    expect(media).not.toBeNull();
    if (!media) return;
    const plan = media.planMediaWorkflow({
      project_id: "22222222-2222-4222-8222-222222222222",
      intent: "Create a storyboard, images and a short narrated video",
    });
    expect(plan.steps.some((step: { capability_id?: string }) => step.capability_id === "capability.storyboard.generate")).toBe(true);
    expect(plan.steps.some((step: { capability_id?: string }) => step.capability_id === "capability.image.generate")).toBe(true);
    expect(plan.steps.some((step: { capability_id?: string }) => step.capability_id === "capability.video.generate")).toBe(true);
    expect(plan).not.toHaveProperty("provider_calls");
  });
});

describe("Nova shared Project Graph workspace boundary", () => {
  test("cross-workspace artifacts stay in one project with typed relations", () => {
    expect(contracts).not.toBeNull();
    if (!contracts) return;
    const projectId = "22222222-2222-4222-8222-222222222222";
    const product = contracts.declareWorkspaceArtifact(projectId, "product_specification", "Aurum specification");
    const campaign = contracts.declareWorkspaceArtifact(projectId, "campaign_document", "Aurum launch campaign");
    const image = contracts.declareWorkspaceArtifact(projectId, "image", "Aurum hero image");
    const relation = contracts.relateWorkspaceArtifacts(campaign, image, "references");
    expect([product, campaign, image].every((artifact: { project_id: string }) => artifact.project_id === projectId)).toBe(true);
    expect(relation).toMatchObject({ project_id: projectId, relation_kind: "references" });
  });

  test("engine adapters degrade cleanly when an existing RONSAS engine is unavailable", () => {
    expect(contracts).not.toBeNull();
    if (!contracts) return;
    const adapters = contracts.resolveWorkspaceEngineAdapters({
      epublisher: true,
      creative_studio: false,
      sync_vision: true,
      local_stt: true,
      local_image: true,
      musetalk: false,
    });
    expect(adapters.epublisher).toMatchObject({ capability_id: "capability.content.publish", state: "verified" });
    expect(adapters.creative_studio).toMatchObject({ capability_id: "capability.media.generate", state: "degraded" });
    expect(adapters.musetalk).toMatchObject({ capability_id: "capability.video.lipsync", state: "degraded" });
  });
});

describe("Nova brand context", () => {
  test("explicit job instructions win while conflicts remain visible", () => {
    expect(brand).not.toBeNull();
    if (!brand) return;
    const result = brand.resolveBrandContext({
      approved: { voice: "calm", audience: "small businesses", typography: "Inter" },
      current: { voice: "energetic" },
    });
    expect(result.effective.voice).toBe("energetic");
    expect(result.effective.audience).toBe("small businesses");
    expect(result.conflicts).toContain("voice");
  });
});

describe("Nova workspace UI boundary", () => {
  test("mode switcher and five creation panels exist", () => {
    const switcher = readFileSync("src/components/nova/WorkspaceModeSwitcher.tsx", "utf8");
    expect(switcher).toContain("Content");
    expect(switcher).toContain("Products");
    expect(switcher).toContain("Media");
    expect(switcher).toContain("Research");
    expect(switcher).toContain("Brand");
    expect(switcher).toContain("Apps");
    const projectRoute = readFileSync("src/routes/nova.projects.$projectId.tsx", "utf8");
    expect(projectRoute).toContain("WorkspaceModeSwitcher");
    expect(projectRoute).toContain("AppFactoryPanel");
    for (const path of [
      "src/components/nova/workspaces/ContentWorkspace.tsx",
      "src/components/nova/workspaces/ProductWorkspace.tsx",
      "src/components/nova/workspaces/MediaWorkspace.tsx",
      "src/components/nova/workspaces/ResearchWorkspace.tsx",
      "src/components/nova/workspaces/BrandWorkspace.tsx",
    ]) expect(readFileSync(path, "utf8")).toContain("aria-label");
  });

  test("capability mesh includes the new provider-neutral workspace capabilities", () => {
    const source = readFileSync("src/lib/nova/capabilities.ts", "utf8");
    for (const capability of [
      "capability.content.publish",
      "capability.media.generate",
      "capability.storyboard.generate",
      "capability.audio.transcribe",
      "capability.video.lipsync",
    ]) expect(source).toContain(capability);
  });
});
