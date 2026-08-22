import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { supabaseAdmin } from "@/integrations/supabase/client.server";

const InputSchema = z.object({
  email: z.string().email().max(255).transform((v) => v.trim().toLowerCase()),
  source: z.string().max(64).optional(),
});

export const subscribeNewsletter = createServerFn({ method: "POST" })
  .inputValidator((input: unknown) => InputSchema.parse(input))
  .handler(async ({ data, context }) => {
    const req = (context as unknown as { request?: Request }).request;
    const user_agent = req?.headers.get("user-agent") ?? null;
    const source_ip =
      req?.headers.get("cf-connecting-ip") ??
      req?.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ??
      null;

    const { error } = await supabaseAdmin
      .from("newsletter_subscribers")
      .upsert(
        {
          email: data.email,
          source: data.source ?? "home_join",
          user_agent,
          source_ip,
        },
        { onConflict: "email", ignoreDuplicates: true },
      );

    if (error) throw new Error(error.message);
    return { ok: true };
  });
