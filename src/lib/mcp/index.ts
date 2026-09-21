import { auth, defineMcp } from "@lovable.dev/mcp-js";
import searchTool from "./tools/datanest-search";
import traceTool from "./tools/datanest-trace";
import { submitMemoryTool, submitCorrectionTool } from "./tools/datanest-submit";
import pulseTool from "./tools/datanest-pulse";
import coverageTool from "./tools/datanest-coverage";
import projectContextTool from "./tools/nova-project-context";

const projectRef = import.meta.env.VITE_SUPABASE_PROJECT_ID ?? "project-ref-unset";

export const GOVERNED_MCP_TOOL_NAMES = [
  "datanest_search",
  "datanest_trace",
  "datanest_submit_memory",
  "datanest_submit_correction",
  "datanest_resonance_pulse",
  "datanest_get_coverage",
  "nova_get_project_context",
] as const;

export default defineMcp({
  name: "ronsas-nova-datanest-mcp",
  title: "RONSAS Nova + DataNest MCP",
  version: "0.2.0",
  instructions: "Governed cross-AI access to approved DataNest memory, provenance, coverage, project context, review candidates and explicit Resonance Pulse feedback. External tools never have canonical-memory approval authority.",
  auth: auth.oauth.issuer({
    issuer: `https://${projectRef}.supabase.co/auth/v1`,
    acceptedAudiences: "authenticated",
  }),
  tools: [searchTool, traceTool, submitMemoryTool, submitCorrectionTool, pulseTool, coverageTool, projectContextTool],
});
