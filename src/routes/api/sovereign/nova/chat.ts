import { createFileRoute } from "@tanstack/react-router";
import { authenticateNovaGatewayRequest, novaGatewayErrorResponse } from "@/lib/nova/model-gateway.server";
import { handleNovaTurn } from "@/lib/nova/orchestrator.server";

export const Route = createFileRoute("/api/sovereign/nova/chat")({
  server: {
    handlers: {
      POST: async ({ request }: { request: Request }) => {
        try {
          const userId = await authenticateNovaGatewayRequest(request);
          const body = await request.json().catch(() => null);
          if (!body || typeof body !== "object") {
            return Response.json(
              { error: { type: "invalid_request", message: "A JSON body is required." } },
              { status: 400 },
            );
          }
          const projectId = typeof (body as any).project_id === "string" ? (body as any).project_id : "";
          const content = typeof (body as any).content === "string" ? (body as any).content : "";
          const conversationId = typeof (body as any).conversation_id === "string" ? (body as any).conversation_id : undefined;
          if (!projectId || !content.trim()) {
            return Response.json(
              { error: { type: "invalid_request", message: "project_id and content are required." } },
              { status: 400 },
            );
          }
          const result = await handleNovaTurn({
            project_id: projectId,
            user_id: userId,
            content,
            conversation_id: conversationId,
          });
          return Response.json(result, { headers: { "Cache-Control": "no-store" } });
        } catch (error) {
          return novaGatewayErrorResponse(error);
        }
      },
    },
  },
});
