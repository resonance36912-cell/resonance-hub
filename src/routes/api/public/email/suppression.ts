import { createFileRoute } from "@tanstack/react-router";
import { handleEmailSuppressionWebhook } from "@/lib/email-suppression.server";

export const Route = createFileRoute("/api/public/email/suppression")({
  server: {
    handlers: {
      POST: ({ request }) => handleEmailSuppressionWebhook(request),
    },
  },
});
