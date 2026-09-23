import { createFileRoute } from "@tanstack/react-router";
import {
  resolveSovereignRequestCredential,
  resolveSovereignRequestUserId,
} from "@/lib/rons-auth-middleware";
import {
  fetchSovereignUserEmail,
  sovereignUserHasRole,
} from "@/lib/backend-provider.server";

function allowedEmails(): Set<string> {
  return new Set(
    (process.env.RONSAS_RND_ALLOWED_EMAILS ?? "")
      .split(",")
      .map((value) => value.trim().toLowerCase())
      .filter(Boolean),
  );
}

function noStore(body: unknown, status = 200) {
  return Response.json(body, {
    status,
    headers: { "Cache-Control": "no-store" },
  });
}

async function authorize(request: Request) {
  const allowlist = allowedEmails();
  if (allowlist.size === 0) {
    return noStore({ ok: false, error: "rnd_allowlist_unconfigured" }, 503);
  }

  const credential = resolveSovereignRequestCredential(request);
  if (!credential) return noStore({ ok: false, error: "unauthorized" }, 401);

  let userId: string | null = null;
  try {
    userId = await resolveSovereignRequestUserId(request);
  } catch {
    return noStore({ ok: false, error: "auth_provider_unavailable" }, 503);
  }
  if (!userId) return noStore({ ok: false, error: "unauthorized" }, 401);

  const [email, isAdmin] = await Promise.all([
    fetchSovereignUserEmail(credential),
    sovereignUserHasRole(userId, "admin"),
  ]);
  if (!email || !isAdmin || !allowlist.has(email.trim().toLowerCase())) {
    return noStore({ ok: false, error: "forbidden" }, 403);
  }

  return noStore({
    ok: true,
    user_id: userId,
    email,
    role: "admin",
    scope: "rnd-control",
    recovery_hold: true,
  });
}

export const Route = createFileRoute("/api/rnd/authorize")({
  server: {
    handlers: {
      GET: async ({ request }) => authorize(request),
      POST: async ({ request }) => authorize(request),
    },
  },
});
