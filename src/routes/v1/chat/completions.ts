import { createFileRoute } from "@tanstack/react-router";
import {
  authenticateNovaGatewayRequest,
  completeNovaChat,
  novaGatewayErrorResponse,
} from "@/lib/nova/model-gateway.server";

export const Route = createFileRoute("/v1/chat/completions")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        try {
          await authenticateNovaGatewayRequest(request);
          const body = await request.json().catch(() => null);
          if (!body || typeof body !== "object" || !Array.isArray((body as any).messages)) {
            return Response.json(
              { error: { type: "invalid_request", message: "A JSON messages array is required." } },
              { status: 400, headers: { "Cache-Control": "no-store" } },
            );
          }
          const completion = await completeNovaChat(body as any);
          return Response.json(completion, { headers: { "Cache-Control": "no-store" } });
        } catch (error) {
          return novaGatewayErrorResponse(error);
        }
      },
    },
  },
});
