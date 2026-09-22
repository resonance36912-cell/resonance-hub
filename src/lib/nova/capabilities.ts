export type NovaProviderState =
  | "discovered"
  | "available"
  | "connected"
  | "verified"
  | "degraded"
  | "blocked"
  | "disabled";

export type NovaProviderCandidate = {
  id: string;
  state: NovaProviderState;
  local: boolean;
  self_hosted: boolean;
  capability_ids: string[];
  permissions: string[];
  estimated_cost_usd?: number;
};

export type CapabilityRoutingContext = {
  required_permission?: string;
  max_cost_usd?: number;
};

export type CapabilityRoute = {
  capability_id: string;
  provider: NovaProviderCandidate;
};

export const NOVA_CAPABILITIES = [
  "capability.git.read",
  "capability.git.write",
  "capability.db.query",
  "capability.db.migrate",
  "capability.browser.observe",
  "capability.image.generate",
  "capability.video.generate",
  "capability.voice.generate",
  "capability.email.send",
  "capability.slack.post",
  "capability.deploy.preview",
  "capability.deploy.production",
  "capability.model.reason",
  "capability.model.code",
  "capability.model.vision",
  "capability.model.embed",
  "capability.content.publish",
  "capability.media.generate",
  "capability.storyboard.generate",
  "capability.audio.transcribe",
  "capability.video.lipsync",
] as const;

export type NovaCapabilityId = (typeof NOVA_CAPABILITIES)[number];
