import { readFile } from "node:fs/promises";
import { resolveHostedBearerUserId } from "@/lib/backend-provider.server";

const COOKIE_NAME = "rons_sovereign_session";
const DEFAULT_GATEWAY = "http://127.0.0.1:58600";
const MAX_BODY_BYTES = 16 * 1024;

export type SovereignAuthAction =
  | "session"
  | "user"
  | "sign-in"
  | "sign-up"
  | "sign-out"
  | "exchange";

const ACTION_PATH: Record<SovereignAuthAction, string> = {
  session: "/v1/auth/session",
  user: "/v1/auth/user",
  "sign-in": "/v1/auth/sign-in",
  "sign-up": "/v1/auth/sign-up",
  "sign-out": "/v1/auth/sign-out",
  exchange: "/v1/auth/exchange",
};

function enabled(): boolean {
  return process.env.RONS_SOVEREIGN_PROXY_ENABLED === "1";
}

function gateway(): string {
  return (process.env.RESONANCE_SOVEREIGN_GATEWAY_URL ?? DEFAULT_GATEWAY).replace(/\/$/, "");
}

async function exchangeSecret(): Promise<string> {
  const path = process.env.RONS_AUTH_EXCHANGE_KEY_FILE?.trim();
  if (!path) throw new Error("auth exchange key path missing");
  const value = (await readFile(path, "utf8")).trim();
  if (value.length < 32 || value.length > 4096) throw new Error("auth exchange key invalid");
  return value;
}

const UUID_SUBJECT = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function bearerToken(request: Request): string | null {
  const header = request.headers.get("authorization") ?? "";
  if (!header.toLowerCase().startsWith("bearer ")) return null;
  const token = header.slice(7).trim();
  return token && token.length <= 8192 ? token : null;
}

function readCookie(request: Request): string | null {
  const header = request.headers.get("cookie") ?? "";
  for (const segment of header.split(";")) {
    const [name, ...rest] = segment.trim().split("=");
    if (name === COOKIE_NAME) {
      const value = rest.join("=").trim();
      return value ? decodeURIComponent(value) : null;
    }
  }
  return null;
}

function cookieHeader(request: Request, value: string, maxAge: number): string {
  const secure = new URL(request.url).protocol === "https:" ? "; Secure" : "";
  return `${COOKIE_NAME}=${encodeURIComponent(value)}; Path=/; HttpOnly; SameSite=Strict; Max-Age=${maxAge}${secure}`;
}

function clearCookieHeader(request: Request): string {
  return cookieHeader(request, "", 0);
}

function json(body: unknown, status: number, headers: HeadersInit = {}): Response {
  const responseHeaders = new Headers(headers);
  responseHeaders.set("Content-Type", "application/json");
  responseHeaders.set("Cache-Control", "no-store");
  return new Response(JSON.stringify(body), { status, headers: responseHeaders });
}

function sameOriginPost(request: Request): boolean {
  const origin = request.headers.get("origin");
  if (!origin) return true;
  return origin === new URL(request.url).origin;
}

function redactSessionToken(payload: unknown): unknown {
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) return payload;
  const clone = structuredClone(payload) as Record<string, unknown>;
  const session = clone.session;
  if (session && typeof session === "object" && !Array.isArray(session)) {
    const cleanSession = { ...(session as Record<string, unknown>) };
    delete cleanSession.access_token;
    cleanSession.token_transport = "httpOnly-cookie";
    clone.session = cleanSession;
  }
  return clone;
}

export async function handleSovereignAuthProxy(
  request: Request,
  action: SovereignAuthAction,
  fetchImpl: typeof fetch = fetch,
  resolveHostedUserId: (accessToken: string) => Promise<string | null> = resolveHostedBearerUserId,
  readExchangeSecret: () => Promise<string> = exchangeSecret,
): Promise<Response> {
  if (!enabled()) return json({ error: "Not found" }, 404);
  if (!(action in ACTION_PATH)) return json({ error: "Unsupported auth action" }, 404);
  const isMutation = action === "sign-in" || action === "sign-up" || action === "sign-out" || action === "exchange";
  if (isMutation && !sameOriginPost(request)) return json({ error: "Origin rejected" }, 403);

  let body: string | undefined;
  let exchangeHeader: string | null = null;
  if (action === "sign-in" || action === "sign-up") {
    body = await request.text();
    if (new TextEncoder().encode(body).byteLength > MAX_BODY_BYTES) {
      return json({ error: "Request too large" }, 413);
    }
    try {
      const parsed = JSON.parse(body) as Record<string, unknown>;
      if (typeof parsed.email !== "string" || typeof parsed.password !== "string") {
        return json({ error: "Invalid credentials payload" }, 400);
      }
    } catch {
      return json({ error: "Invalid JSON" }, 400);
    }
  } else if (action === "exchange") {
    const hostedToken = bearerToken(request);
    if (!hostedToken) return json({ error: "Missing hosted Bearer token" }, 401);
    let subject: string | null = null;
    try { subject = await resolveHostedUserId(hostedToken); }
    catch { return json({ error: "Hosted auth verification unavailable" }, 503); }
    if (!subject) return json({ error: "Invalid hosted session" }, 401);
    if (!UUID_SUBJECT.test(subject)) return json({ error: "Invalid hosted identity subject" }, 502);
    try { exchangeHeader = await readExchangeSecret(); }
    catch { return json({ error: "Sovereign exchange unavailable" }, 503); }
    body = JSON.stringify({ provider: "supabase", subject });
  }

  const token = readCookie(request);
  const headers: Record<string, string> = {};
  if (body !== undefined) headers["Content-Type"] = "application/json";
  if (exchangeHeader) headers["X-RONS-Exchange-Key"] = exchangeHeader;
  else if (token) headers.Authorization = `Bearer ${token}`;

  let upstream: Response;
  try {
    upstream = await fetchImpl(`${gateway()}${ACTION_PATH[action]}`, {
      method: isMutation ? "POST" : "GET",
      headers,
      body,
    });
  } catch {
    return json({ error: "Sovereign auth unavailable" }, 503);
  }

  const text = await upstream.text();
  let payload: unknown = null;
  if (text) {
    try { payload = JSON.parse(text); }
    catch { payload = { error: "Invalid sovereign auth response" }; }
  }

  const responseHeaders = new Headers();
  if (action === "sign-out") {
    responseHeaders.set("Set-Cookie", clearCookieHeader(request));
  } else if (upstream.ok && (action === "sign-in" || action === "sign-up" || action === "exchange")) {
    const session = payload && typeof payload === "object" && !Array.isArray(payload)
      ? (payload as Record<string, unknown>).session
      : null;
    const accessToken = session && typeof session === "object" && !Array.isArray(session)
      ? (session as Record<string, unknown>).access_token
      : null;
    if (typeof accessToken !== "string" || accessToken.length < 16 || accessToken.length > 4096) {
      return json({ error: "Invalid sovereign session response" }, 502);
    }
    responseHeaders.set("Set-Cookie", cookieHeader(request, accessToken, 86400));
    payload = redactSessionToken(payload);
  }

  return json(payload, upstream.status, responseHeaders);
}
