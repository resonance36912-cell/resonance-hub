export const NOVA_MODEL_IDS = [
  "ronsas-nova",
  "ronsas-nova-code",
  "ronsas-nova-reasoning",
  "ronsas-nova-vision",
  "ronsas-nova-embed",
] as const;

export type NovaModelId = (typeof NOVA_MODEL_IDS)[number];
export type NovaModelCapability =
  | "capability.model.reason"
  | "capability.model.code"
  | "capability.model.vision"
  | "capability.model.embed";

export type NovaModelDefinition = {
  id: NovaModelId;
  capability_id: NovaModelCapability;
  description: string;
};

const DEFINITIONS: Record<NovaModelId, NovaModelDefinition> = {
  "ronsas-nova": {
    id: "ronsas-nova",
    capability_id: "capability.model.reason",
    description: "RONSAS Nova general collaborative model identity",
  },
  "ronsas-nova-code": {
    id: "ronsas-nova-code",
    capability_id: "capability.model.code",
    description: "RONSAS Nova code and app-building model identity",
  },
  "ronsas-nova-reasoning": {
    id: "ronsas-nova-reasoning",
    capability_id: "capability.model.reason",
    description: "RONSAS Nova reasoning model identity",
  },
  "ronsas-nova-vision": {
    id: "ronsas-nova-vision",
    capability_id: "capability.model.vision",
    description: "RONSAS Nova vision model identity",
  },
  "ronsas-nova-embed": {
    id: "ronsas-nova-embed",
    capability_id: "capability.model.embed",
    description: "RONSAS Nova embedding model identity",
  },
};

export function getNovaModel(model: string): NovaModelDefinition {
  const definition = DEFINITIONS[model as NovaModelId];
  if (!definition) throw new Error("model_not_found");
  return definition;
}

export function openAiModelList() {
  return {
    object: "list" as const,
    data: NOVA_MODEL_IDS.map((id) => ({
      id,
      object: "model" as const,
      created: 1_789_862_400,
      owned_by: "resonance-sovereign",
    })),
  };
}
