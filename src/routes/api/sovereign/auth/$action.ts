import { createFileRoute } from "@tanstack/react-router";
import {
  handleSovereignAuthProxy,
  type SovereignAuthAction,
} from "@/lib/sovereign-auth-proxy.server";

const GET_ACTIONS = new Set<SovereignAuthAction>(["session", "user"]);
const POST_ACTIONS = new Set<SovereignAuthAction>(["sign-in", "sign-up", "sign-out", "exchange"]);

function actionFromRequest(request: Request): SovereignAuthAction | null {
  const action = new URL(request.url).pathname.split("/").filter(Boolean).at(-1) ?? "";
  if (
    GET_ACTIONS.has(action as SovereignAuthAction) ||
    POST_ACTIONS.has(action as SovereignAuthAction)
  ) {
    return action as SovereignAuthAction;
  }
  return null;
}

function methodNotAllowed(allow: string): Response {
  return Response.json(
    { error: "Method not allowed" },
    { status: 405, headers: { Allow: allow, "Cache-Control": "no-store" } },
  );
}

export const Route = createFileRoute("/api/sovereign/auth/$action")({
  server: {
    handlers: {
      GET: async ({ request }) => {
        const action = actionFromRequest(request);
        if (!action) return Response.json({ error: "Unknown auth action" }, { status: 404 });
        if (!GET_ACTIONS.has(action)) return methodNotAllowed("POST");
        return handleSovereignAuthProxy(request, action);
      },
      POST: async ({ request }) => {
        const action = actionFromRequest(request);
        if (!action) return Response.json({ error: "Unknown auth action" }, { status: 404 });
        if (!POST_ACTIONS.has(action)) return methodNotAllowed("GET");
        return handleSovereignAuthProxy(request, action);
      },
    },
  },
});
