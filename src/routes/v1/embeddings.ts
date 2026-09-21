import { createFileRoute } from "@tanstack/react-router";
import {
  authenticateNovaGatewayRequest,
  embeddingCapabilityNotConfigured,
  novaGatewayErrorResponse,
} from "@/lib/nova/model-gateway.server";

export const Route = createFileRoute("/v1/embeddings")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        try {
          await authenticateNovaGatewayRequest(request);
          return embeddingCapabilityNotConfigured();
        } catch (error) {
          return novaGatewayErrorResponse(error);
        }
      },
    },
  },
});
