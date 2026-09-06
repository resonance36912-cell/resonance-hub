import type { ZodRawShape } from "zod";
import echoTool from "./tools/echo";
import listUpdatesTool from "./tools/list-updates";

export type RonsToolResult = {
  content?: Array<{ type: "text"; text: string }>;
  structuredContent?: Record<string, unknown>;
  isError?: boolean;
};

export type RonsMcpTool = {
  name: string;
  title: string;
  description: string;
  inputSchema?: ZodRawShape;
  annotations?: Record<string, boolean>;
  handler: (args: any) => RonsToolResult | Promise<RonsToolResult>;
};

const supabaseBase = String(import.meta.env.VITE_SUPABASE_URL ?? "").replace(/\/$/, "");
const projectRef = import.meta.env.VITE_SUPABASE_PROJECT_ID ?? "project-ref-unset";
const explicitIssuer = process.env.RONS_MCP_ISSUER?.trim();
const fallbackIssuer = supabaseBase ? `${supabaseBase}/auth/v1` : `https://${projectRef}.supabase.co/auth/v1`;
const issuer = (explicitIssuer || fallbackIssuer).replace(/\/$/, "");
const configured = Boolean(explicitIssuer || (supabaseBase.startsWith("https://") && !supabaseBase.includes("127.0.0.1")));
const jwksUrl = process.env.RONS_MCP_JWKS_URL ?? `${issuer}/.well-known/jwks.json`;
export const ronsMcp = {
  name: "reson8-hub-mcp",
  title: "Reson8 Hub MCP",
  version: "0.2.0",
  instructions:
    "Tools for the Reson8 hub. Use echo to verify connectivity and list_updates to fetch recent Reson8 project updates.",
  auth: {
    configured,
    issuer,
    jwksUrl,
    acceptedAudiences: ["authenticated"] as const,
    algorithms: ["RS256", "RS384", "RS512", "ES256", "ES384", "ES512", "EdDSA"] as const,
    accessTokenTypes: ["at+jwt", "JWT"] as const,
    requireClientId: true,
    requiredScopes: [] as readonly string[],
  },
  tools: [echoTool, listUpdatesTool] as RonsMcpTool[],
} as const;

export default ronsMcp;