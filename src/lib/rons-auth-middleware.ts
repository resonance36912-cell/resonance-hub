import { createMiddleware } from "@tanstack/react-start";
import { getRequest } from "@tanstack/react-start/server";
import {
  getBackendProvider,
  resolveBackendUser,
  type BackendUser,
} from "@/lib/backend-provider.server";

const SESSION_COOKIE = "rons_sovereign_session";
const MAX_CREDENTIAL_LENGTH = 8192;

function bearerToken(request: Request): string | null {
  const header = request.headers.get("authorization") ?? "";
  if (!header.toLowerCase().startsWith("bearer ")) return null;
  const value = header.slice(7).trim();
  return value && value.length <= MAX_CREDENTIAL_LENGTH ? value : null;
}

function cookieToken(request: Request): string | null {
  for (const segment of (request.headers.get("cookie") ?? "").split(";")) {
    const [name, ...rest] = segment.trim().split("=");
    if (name !== SESSION_COOKIE) continue;
    const raw = rest.join("=").trim();
    if (!raw || raw.length > MAX_CREDENTIAL_LENGTH) return null;
    try {
      return decodeURIComponent(raw);
    } catch {
      return null;
    }
  }
  return null;
}
export function resolveRonsRequestCredential(request: Request): string | null {
  if (getBackendProvider() === "sovereign") return cookieToken(request) ?? bearerToken(request);
  return bearerToken(request);
}

export async function resolveRonsRequestUser(request: Request): Promise<BackendUser | null> {
  const credential = resolveRonsRequestCredential(request);
  if (!credential) return null;
  return resolveBackendUser(credential);
}

export const requireRonsAuth = createMiddleware({ type: "function" }).server(async ({ next }) => {
  const request = getRequest();
  if (!request?.headers) throw new Error("Unauthorized: No request headers available");
  const credential = resolveRonsRequestCredential(request);
  if (!credential) throw new Error("Unauthorized: Invalid or missing session");

  let user: BackendUser | null = null;
  try {
    user = await resolveBackendUser(credential);
  } catch {
    throw new Error("Unauthorized: Authentication provider unavailable");
  }
  if (!user) throw new Error("Unauthorized: Invalid or missing session");

  return next({
    context: {
      userId: user.id,
      user,
      credential,
      authProvider: getBackendProvider(),
    },
  });
});
