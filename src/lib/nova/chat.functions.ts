import { z } from "zod";
import { createServerFn } from "@tanstack/react-start";
import { requireRonsAuth } from "@/lib/rons-auth-middleware";
import { handleNovaTurn } from "@/lib/nova/orchestrator.server";

const SendNovaTurnInput = z.object({
  project_id: z.string().uuid(),
  content: z.string().trim().min(1).max(200_000),
  conversation_id: z.string().uuid().optional(),
}).strict();

export const sendNovaTurn = createServerFn({ method: "POST" })
  .middleware([requireRonsAuth])
  .validator((input: unknown) => SendNovaTurnInput.parse(input))
  .handler(async ({ data, context }) => handleNovaTurn({
    project_id: data.project_id,
    user_id: context.userId,
    content: data.content,
    conversation_id: data.conversation_id,
  }));
