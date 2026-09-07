const COOKIE_NAME = "rons_sovereign_session";
const DEFAULT_GATEWAY = "http://127.0.0.1:58600";
const MAX_BODY_BYTES = 16 * 1024;

export type SovereignAuthAction =
  | "session"
  | "user"
  | "sign-in"
  | "sign-up"
  | "sign-out";

const ACTION_PATH: Record<SovereignAuthAction, string> = {
  session: "/v1/auth/session",
  user: "/v1/auth/user",
  "sign-in": "/v1/auth/sign-in",
  "sign-up": "/v1/auth/sign-up",
  "sign-out": "/v1/auth/sign-out",
};

function enabled(): boolean {
  return process.env.RONS_SOVEREIGN_PROXY_ENABLED === "1";
}

function gateway(): string {
  return (process.env.RESONANCE_SOVEREIGN_GATEWAY_URL ?? DEFAULT_GATEWAY).replace(/\/$/, "");
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
): Promise<Response> {
  if (!enabled()) return json({ error: "Not found" }, 404);
  if (!(action in ACTION_PATH)) return json({ error: "Unsupported auth action" }, 404);
  const isMutation = action === "sign-in" || action === "sign-up" || action === "sign-out";
  if (isMutation && !sameOriginPost(request)) return json({ error: "Origin rejected" }, 403);

  let body: string | undefined;
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
  }

  const token = readCookie(request);
  const headers: Record<string, string> = {};
  if (body !== undefined) headers["Content-Type"] = "application/json";
  if (token) headers.Authorization = `Bearer ${token}`;

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
  } else if (upstream.ok && (action === "sign-in" || action === "sign-up")) {
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
