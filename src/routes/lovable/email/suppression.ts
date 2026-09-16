import { createFileRoute } from "@tanstack/react-router";
import { handleEmailSuppressionWebhook } from "@/lib/email-suppression.server";

// Legacy internal route retained for compatibility. Public webhook traffic uses
// /api/public/email/suppression because /lovable/email/* is blocked at the edge.
export const Route = createFileRoute("/lovable/email/suppression")({
  server: {
    handlers: {
      POST: ({ request }) => handleEmailSuppressionWebhook(request),
    },
  },
});
