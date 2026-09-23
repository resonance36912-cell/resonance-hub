import { auth, defineMcp } from "@lovable.dev/mcp-js";
import searchTool from "./tools/datanest-search";
import traceTool from "./tools/datanest-trace";
import { submitMemoryTool, submitCorrectionTool } from "./tools/datanest-submit";
import pulseTool from "./tools/datanest-pulse";
import coverageTool from "./tools/datanest-coverage";
import projectContextTool from "./tools/nova-project-context";
import remoteListDevicesTool from "./tools/remote-list-devices";
import remoteGetSnapshotTool from "./tools/remote-get-snapshot";

const supabaseUrl = (process.env.SUPABASE_URL ?? import.meta.env.VITE_SUPABASE_URL ?? "https://supabase.invalid").replace(/\/+$/, "");

export const GOVERNED_MCP_TOOL_NAMES = [
  "datanest_search",
  "datanest_trace",
  "datanest_submit_memory",
  "datanest_submit_correction",
  "datanest_resonance_pulse",
  "datanest_get_coverage",
  "nova_get_project_context",
  "remote_list_devices",
  "remote_get_snapshot",
] as const;

export default defineMcp({
  name: "ronsas-nova-datanest-mcp",
  title: "RONSAS Nova + DataNest + Remote Evidence MCP",
  version: "0.3.0",
  instructions: "Governed RONSAS project context, approved DataNest memory operations, and read-only Remote Bridge device evidence. Remote evidence tools never execute commands, release recovery HOLDs, or grant desktop control.",
  auth: auth.oauth.issuer({
    issuer: `${supabaseUrl}/auth/v1`,
    acceptedAudiences: "authenticated",
  }),
  tools: [
    searchTool,
    traceTool,
    submitMemoryTool,
    submitCorrectionTool,
    pulseTool,
    coverageTool,
    projectContextTool,
    remoteListDevicesTool,
    remoteGetSnapshotTool,
  ],
});
