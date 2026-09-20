import { createHash } from "node:crypto";
import { z } from "zod";

export const NovaConversationRole = z.enum(["system", "user", "assistant", "tool"]);
export const NovaContributorKind = z.enum(["human", "ai", "service"]);

export const CreateNovaConversationInput = z.object({
  project_id: z.string().uuid(),
  title: z.string().trim().min(1).max(180).optional(),
}).strict();

export const AppendNovaMessageInput = z.object({
  project_id: z.string().uuid(),
  conversation_id: z.string().uuid(),
  role: NovaConversationRole,
  contributor_kind: NovaContributorKind,
  contributor_id: z.string().trim().min(1).max(180).optional(),
  content: z.string().min(1).max(200_000),
  model_id: z.string().max(160).optional(),
  provider_id: z.string().max(160).optional(),
  provider_trace: z.record(z.string(), z.unknown()).optional().default({}),
  memory_ids: z.array(z.string().uuid()).max(200).optional().default([]),
  artifact_ids: z.array(z.string().uuid()).max(200).optional().default([]),
  source_refs: z.array(z.record(z.string(), z.unknown())).max(200).optional().default([]),
}).strict();

export function hashNovaMessage(content: string): string {
  return createHash("sha256").update(content).digest("hex");
}
