import { auth, defineMcp } from "@lovable.dev/mcp-js";
import echoTool from "./tools/echo";
import listUpdatesTool from "./tools/list-updates";

// OAuth issuer MUST be the direct Supabase host — the `.lovable.cloud` proxy
// fails RFC 8414 issuer discovery. VITE_SUPABASE_PROJECT_ID is inlined by Vite
// at build time; the fallback keeps the issuer well-formed during the
// manifest-extract eval (no real token verifies against it).
const projectRef = import.meta.env.VITE_SUPABASE_PROJECT_ID ?? "project-ref-unset";

export default defineMcp({
  name: "reson8-hub-mcp",
  title: "Reson8 Hub MCP",
  version: "0.1.0",
  instructions:
    "Tools for the Reson8 hub. Use `echo` to verify connectivity and `list_updates` to fetch recent Reson8 project updates.",
  auth: auth.oauth.issuer({
    issuer: `https://${projectRef}.supabase.co/auth/v1`,
    acceptedAudiences: "authenticated",
  }),
  tools: [echoTool, listUpdatesTool],
});
