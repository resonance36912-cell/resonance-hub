import { z } from "zod";

const SourceSchema = z.object({
  repo: z.string().trim().min(3).max(240),
  branch: z.string().trim().min(1).max(240),
  worktree: z.string().trim().min(1).max(1000),
}).strict();

export const AppManifestSchema = z.object({
  app_id: z.string().uuid(),
  project_id: z.string().uuid(),
  name: z.string().trim().min(3).max(120),
  source: SourceSchema,
  runtime: z.enum(["web"]),
  routes: z.array(z.string().trim().min(1).max(500)).max(500),
  database_resources: z.array(z.string().trim().min(1).max(240)).max(500),
  integrations: z.array(z.string().trim().min(1).max(240)).max(200),
  required_secrets: z.array(z.string().trim().min(1).max(240)).max(200),
  deployment_target: z.enum(["preview", "staging", "production"]),
  tests: z.array(z.string().trim().min(1).max(500)).min(1).max(100),
  health_endpoints: z.array(z.string().trim().min(1).max(500)).min(1).max(100),
  datanest_scope: z.string().trim().min(1).max(160),
  governance_class: z.enum(["A0", "A1", "A2", "A3", "A4", "A5"]),
  rollback_ref: z.string().trim().min(1).max(500),
}).strict();

export type AppManifest = z.infer<typeof AppManifestSchema>;
