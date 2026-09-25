import { z } from "zod";
import { ProjectRole } from "@/lib/nova/contracts";

export const CollaborationProjectId = z
  .object({
    project_id: z.string().uuid(),
  })
  .strict();

export const AddProjectMemberInput = z
  .object({
    project_id: z.string().uuid(),
    user_id: z.string().uuid(),
    role: ProjectRole.exclude(["owner"]),
  })
  .strict();

export const RemoveProjectMemberInput = z
  .object({
    project_id: z.string().uuid(),
    user_id: z.string().uuid(),
  })
  .strict();

export const IntegrationProvider = z.enum(["github", "supabase", "chatgpt", "ai", "browser"]);

export const IntegrationMetadataValue = z.union([
  z.string().max(2000),
  z.number(),
  z.boolean(),
  z.null(),
  z.array(z.string().max(500)).max(50),
]);

const FORBIDDEN_METADATA_KEY =
  /(?:access[_-]?token|refresh[_-]?token|password|passwd|cookie|secret|api[_-]?key|service[_-]?role)/i;
const FORBIDDEN_EXTERNAL_REF = /(?:password|token|secret|api[_-]?key)=|:\/\/[^/\s]+@/i;

function assertSafeMetadata(value: Record<string, unknown>, ctx: z.RefinementCtx) {
  const encoded = JSON.stringify(value);
  if (encoded.length > 16_000) {
    ctx.addIssue({ code: "custom", message: "integration_metadata_too_large" });
  }
  for (const key of Object.keys(value)) {
    if (FORBIDDEN_METADATA_KEY.test(key)) {
      ctx.addIssue({ code: "custom", path: [key], message: "credential_metadata_forbidden" });
    }
  }
}

export const AttachIntegrationInput = z
  .object({
    project_id: z.string().uuid(),
    provider: IntegrationProvider,
    display_name: z.string().trim().min(1).max(160),
    external_ref: z.string().trim().min(1).max(500),
    metadata: z.record(z.string(), IntegrationMetadataValue).optional().default({}),
  })
  .strict()
  .superRefine((value, ctx) => {
    assertSafeMetadata(value.metadata, ctx);
    if (FORBIDDEN_EXTERNAL_REF.test(value.external_ref)) {
      ctx.addIssue({ code: "custom", path: ["external_ref"], message: "credential_reference_forbidden" });
    }
    if (
      value.provider === "github" &&
      !/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(value.external_ref)
    ) {
      ctx.addIssue({ code: "custom", path: ["external_ref"], message: "invalid_github_repository" });
    }
  });

export const RevokeIntegrationInput = z
  .object({
    project_id: z.string().uuid(),
    integration_id: z.string().uuid(),
  })
  .strict();

export const AttachDeviceInput = z
  .object({
    project_id: z.string().uuid(),
    device_id: z.string().uuid(),
    permission: z.enum(["observe", "execute"]),
  })
  .strict();

export const DetachDeviceInput = z
  .object({
    project_id: z.string().uuid(),
    device_id: z.string().uuid(),
  })
  .strict();
