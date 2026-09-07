import { createMiddleware } from "@tanstack/react-start";
import { getRequest } from "@tanstack/react-start/server";
import {
  getBackendProvider,
  resolveHostedBearerUserId,
} from "@/lib/backend-provider.server";

const SESSION_COOKIE = "rons_sovereign_session";
const DEFAULT_GATEWAY = "http://127.0.0.1:58600";

function bearerToken(request: Request): string | null {
  const header = request.headers.get("authorization") ?? "";
  if (!header.toLowerCase().startsWith("bearer ")) return null;
  const token = header.slice(7).trim();
  return token && token.length <= 8192 ? token : null;
}

function cookieToken(request: Request): string | null {
  for (const segment of (request.headers.get("cookie") ?? "").split(";")) {
    const [name, ...rest] = segment.trim().split("=");
    if (name !== SESSION_COOKIE) continue;
    const value = rest.join("=").trim();
    return value ? decodeURIComponent(value) : null;
  }
  return null;
}
async function resolveSovereignCookieUserId(
  request: Request,
  fetchImpl: typeof fetch = fetch,
): Promise<string | null> {
  const token = cookieToken(request) ?? bearerToken(request);
  if (!token) return null;
  const gateway = (process.env.RESONANCE_SOVEREIGN_GATEWAY_URL ?? DEFAULT_GATEWAY).replace(/\/$/, "");
  const response = await fetchImpl(`${gateway}/v1/auth/user`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!response.ok) return null;
  const body = (await response.json()) as { user?: { id?: string } };
  return body.user?.id ?? null;
}

export async function resolveRonsRequestUserId(
  request: Request,
  fetchImpl: typeof fetch = fetch,
): Promise<string | null> {
  if (getBackendProvider() === "sovereign") {
    return resolveSovereignCookieUserId(request, fetchImpl);
  }
  const token = bearerToken(request);
  if (!token) return null;
  return resolveHostedBearerUserId(token);
}
export const requireRonsAuth = createMiddleware({ type: "function" }).server(
  async ({ next }) => {
    const request = getRequest();
    if (!request?.headers) throw new Error("Unauthorized: No request headers available");
    let userId: string | null = null;
    try {
      userId = await resolveRonsRequestUserId(request);
    } catch {
      throw new Error("Unauthorized: Authentication provider unavailable");
    }
    if (!userId) throw new Error("Unauthorized: Invalid or missing session");
    return next({
      context: {
        userId,
        authProvider: getBackendProvider(),
      },
    });
  },
);
