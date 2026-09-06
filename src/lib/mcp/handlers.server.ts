import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { WebStandardStreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js";
import { createRemoteJWKSet, decodeProtectedHeader, jwtVerify, type JWTPayload } from "jose";
import { z } from "zod";
import ronsMcp, { type RonsMcpTool } from "./index";

const JSON_HEADERS = { "Content-Type": "application/json" };
const EXPOSE_HEADERS = "WWW-Authenticate, Mcp-Session-Id, Mcp-Protocol-Version";
const ALLOW_HEADERS = "Authorization, Content-Type, Mcp-Session-Id, Mcp-Protocol-Version, Last-Event-ID";
const jwksCache = new Map<string, ReturnType<typeof createRemoteJWKSet>>();

type AuthContext = {
  claims: JWTPayload;
  sub: string;
  clientId: string;
  scopes: string[];
};

function withCors(response: Response): Response {
  response.headers.set("Access-Control-Allow-Origin", "*");
  response.headers.set("Access-Control-Expose-Headers", EXPOSE_HEADERS);
  return response;
}
function preflight(methods: string): Response {
  return new Response(null, {
    status: 204,
    headers: {
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Methods": methods,
      "Access-Control-Allow-Headers": ALLOW_HEADERS,
      "Access-Control-Max-Age": "86400",
    },
  });
}

function publicOrigin(request: Request): string {
  const url = new URL(request.url);
  const forwardedHost = request.headers.get("x-forwarded-host")?.split(",")[0]?.trim();
  const forwardedProto = request.headers.get("x-forwarded-proto")?.split(",")[0]?.trim();
  const host = forwardedHost || request.headers.get("host") || url.host;
  const protocol = forwardedProto || url.protocol.replace(":", "");
  return `${protocol}://${host}`;
}

function resourceUrl(request: Request): string {
  return `${publicOrigin(request)}/mcp`;
}

function metadataUrl(request: Request): string {
  return `${publicOrigin(request)}/.well-known/oauth-protected-resource`;
}
function bearerToken(request: Request): string | null {
  const header = request.headers.get("authorization")?.trim() ?? "";
  const match = /^Bearer\s+([^\s]+)$/i.exec(header);
  return match?.[1] ?? null;
}

function challenge(request: Request, status: 401 | 403, error?: string): Response {
  const params = [
    'realm="mcp"',
    `resource_metadata="${metadataUrl(request)}"`,
  ];
  if (ronsMcp.auth.requiredScopes.length) {
    params.push(`scope="${ronsMcp.auth.requiredScopes.join(" ")}"`);
  }
  if (error) params.push(`error="${error.replace(/["\\]/g, "")}"`);
  return withCors(
    new Response(JSON.stringify({ error: status === 403 ? "forbidden" : "unauthorized" }), {
      status,
      headers: {
        ...JSON_HEADERS,
        "Cache-Control": "no-store",
        "WWW-Authenticate": `Bearer ${params.join(", ")}`,
      },
    }),
  );
}
function splitScopes(value: unknown): string[] {
  if (typeof value === "string") return value.split(/\s+/).filter(Boolean);
  if (Array.isArray(value)) return value.filter((entry): entry is string => typeof entry === "string");
  return [];
}

function getJwks(jwksUrl: string) {
  let set = jwksCache.get(jwksUrl);
  if (!set) {
    set = createRemoteJWKSet(new URL(jwksUrl));
    jwksCache.set(jwksUrl, set);
  }
  return set;
}

async function authorize(request: Request): Promise<AuthContext | Response> {
  if (!ronsMcp.auth.configured) return withCors(Response.json({ error: "mcp authentication not configured" }, { status: 503, headers: { "Cache-Control": "no-store" } }));
  const token = bearerToken(request);
  if (!token) return challenge(request, 401);

  try {
    const header = decodeProtectedHeader(token);
    if (!header.alg || !ronsMcp.auth.algorithms.includes(header.alg as any)) {
      return challenge(request, 401, "invalid_token");
    }
    if (!header.typ || !ronsMcp.auth.accessTokenTypes.includes(header.typ as any)) {
      return challenge(request, 401, "invalid_token");
    }
    const issuer = ronsMcp.auth.issuer.replace(/\/$/, "");
    const { payload } = await jwtVerify(token, getJwks(ronsMcp.auth.jwksUrl), {
      issuer: [issuer, `${issuer}/`],
      audience: [...ronsMcp.auth.acceptedAudiences],
      algorithms: [...ronsMcp.auth.algorithms],
      requiredClaims: ["sub", "exp"],
      clockTolerance: 30,
    });
    const sub = typeof payload.sub === "string" ? payload.sub.trim() : "";
    if (!sub) return challenge(request, 401, "invalid_token");
    const rawClientId = payload.client_id ?? payload.azp;
    const clientId = typeof rawClientId === "string" ? rawClientId.trim() : "";
    if (ronsMcp.auth.requireClientId && !clientId) {
      return challenge(request, 401, "invalid_token");
    }
    const scopes = splitScopes(payload.scope);
    const missing = ronsMcp.auth.requiredScopes.filter((scope) => !scopes.includes(scope));
    if (missing.length) return challenge(request, 403, "insufficient_scope");
    return { claims: payload, sub, clientId, scopes };
  } catch (error) {
    console.warn("[RONS MCP] token verification rejected", {
      message: error instanceof Error ? error.message : String(error),
    });
    return challenge(request, 401, "invalid_token");
  }
}
function methodNotAllowed(allow: string): Response {
  return withCors(
    new Response(JSON.stringify({ error: "method not allowed" }), {
      status: 405,
      headers: { ...JSON_HEADERS, Allow: allow },
    }),
  );
}

async function executeTool(tool: RonsMcpTool, args: any) {
  try {
    const result = await tool.handler(args);
    if (!result) {
      return { content: [{ type: "text" as const, text: `tool "${tool.name}" returned no result` }], isError: true };
    }
    return {
      content: result.content ?? [],
      structuredContent: result.structuredContent,
      isError: result.isError,
    };
  } catch (error) {
    console.error("[RONS MCP] tool execution failed", {
      tool: tool.name,
      message: error instanceof Error ? error.message : String(error),
    });
    return { content: [{ type: "text" as const, text: "tool execution failed" }], isError: true };
  }
}
export async function handleMcp(request: Request): Promise<Response> {
  if (request.method === "OPTIONS") return preflight("GET, POST, DELETE, OPTIONS");
  const auth = await authorize(request);
  if (auth instanceof Response) return auth;

  try {
    const server = new McpServer(
      { name: ronsMcp.name, version: ronsMcp.version, title: ronsMcp.title },
      { instructions: ronsMcp.instructions },
    );
    for (const tool of ronsMcp.tools) {
      server.registerTool(
        tool.name,
        {
          title: tool.title,
          description: tool.description,
          inputSchema: tool.inputSchema,
          annotations: tool.annotations as any,
        },
        async (args) => executeTool(tool, args),
      );
    }
    const transport = new WebStandardStreamableHTTPServerTransport({ sessionIdGenerator: undefined });
    await server.connect(transport);
    return withCors(await transport.handleRequest(request));
  } catch (error) {
    console.error("[RONS MCP] transport failed", {
      message: error instanceof Error ? error.message : String(error),
    });
    return withCors(
      Response.json(
        { jsonrpc: "2.0", id: null, error: { code: -32603, message: "internal error" } },
        { status: 500 },
      ),
    );
  }
}

function toolListing(tool: RonsMcpTool) {
  let inputSchema: unknown = null;
  if (tool.inputSchema) {
    try {
      inputSchema = z.toJSONSchema(z.object(tool.inputSchema));
    } catch {
      inputSchema = null;
    }
  }
  return {
    name: tool.name,
    title: tool.title,
    description: tool.description,
    annotations: tool.annotations,
    inputSchema,
  };
}
export async function handleListTools(request: Request): Promise<Response> {
  if (request.method === "OPTIONS") return preflight("GET, HEAD, OPTIONS");
  const auth = await authorize(request);
  if (auth instanceof Response) return auth;
  if (request.method !== "GET" && request.method !== "HEAD") {
    return methodNotAllowed("GET, HEAD, OPTIONS");
  }

  const response = Response.json({
    server: { name: ronsMcp.name, version: ronsMcp.version, title: ronsMcp.title },
    tools: ronsMcp.tools.map(toolListing),
  });
  const cors = withCors(response);
  return request.method === "HEAD"
    ? new Response(null, { status: cors.status, headers: cors.headers })
    : cors;
}

function safeToolName(name: string): string {
  return String(name).slice(0, 256);
}

export async function handleInvokeTool(request: Request, toolName: string): Promise<Response> {
  if (request.method === "OPTIONS") return preflight("POST, OPTIONS");
  const auth = await authorize(request);
  if (auth instanceof Response) return auth;
  if (request.method !== "POST") return methodNotAllowed("POST, OPTIONS");
  const tool = ronsMcp.tools.find((candidate) => candidate.name === toolName);
  if (!tool) {
    return withCors(
      Response.json({ error: `unknown tool: ${safeToolName(toolName)}` }, { status: 404 }),
    );
  }

  let rawArgs: unknown = {};
  const text = await request.text();
  if (text) {
    try {
      rawArgs = JSON.parse(text);
    } catch {
      return withCors(Response.json({ error: "invalid JSON body" }, { status: 400 }));
    }
  }

  let args = rawArgs;
  if (tool.inputSchema) {
    const parsed = await z.object(tool.inputSchema).safeParseAsync(rawArgs);
    if (!parsed.success) {
      return withCors(
        Response.json(
          { error: "validation failed", details: parsed.error.message },
          { status: 400 },
        ),
      );
    }
    args = parsed.data;
  } else if (
    rawArgs === null ||
    typeof rawArgs !== "object" ||
    Array.isArray(rawArgs) ||
    Object.keys(rawArgs as Record<string, unknown>).length > 0
  ) {
    return withCors(
      Response.json({ error: "tool has no inputSchema; expected empty body" }, { status: 400 }),
    );
  }

  const result = await executeTool(tool, args);
  return withCors(
    Response.json({
      content: result.content ?? [],
      structuredContent: result.structuredContent,
      isError: result.isError,
    }),
  );
}

export async function handleProtectedResourceMetadata(request: Request): Promise<Response> {
  if (!ronsMcp.auth.configured) return withCors(Response.json({ error: "mcp authentication not configured" }, { status: 503, headers: { "Cache-Control": "no-store" } }));
  if (request.method === "OPTIONS") return preflight("GET, HEAD, OPTIONS");
  if (request.method !== "GET" && request.method !== "HEAD") {
    return methodNotAllowed("GET, HEAD, OPTIONS");
  }
  const body: Record<string, unknown> = {
    resource: resourceUrl(request),
    authorization_servers: [ronsMcp.auth.issuer],
    bearer_methods_supported: ["header"],
    resource_name: ronsMcp.title,
  };
  if (ronsMcp.auth.requiredScopes.length) {
    body.scopes_supported = [...ronsMcp.auth.requiredScopes];
  }
  const response = withCors(
    Response.json(body, {
      headers: {
        "Cache-Control": "public, max-age=300",
        Vary: "Host",
      },
    }),
  );
  return request.method === "HEAD"
    ? new Response(null, { status: response.status, headers: response.headers })
    : response;
}