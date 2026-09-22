import { createFileRoute } from "@tanstack/react-router";
import {
  authenticateNovaGatewayRequest,
  listNovaModelsResponse,
  novaGatewayErrorResponse,
} from "@/lib/nova/model-gateway.server";

export const Route = createFileRoute("/v1/models")({
  server: {
    handlers: {
      GET: async ({ request }) => {
        try {
          await authenticateNovaGatewayRequest(request);
          return listNovaModelsResponse();
        } catch (error) {
          return novaGatewayErrorResponse(error);
        }
      },
    },
  },
});
