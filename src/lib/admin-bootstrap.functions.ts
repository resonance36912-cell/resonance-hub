import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { supabaseAdmin } from "@/integrations/supabase/client.server";

/**
 * Bootstrap an admin: if the user_roles table contains NO admin rows yet,
 * grant the currently signed-in user the admin role. Once any admin exists,
 * this becomes a no-op — additional admins must be granted manually.
 */
export const bootstrapAdmin = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { data: existing, error: existingErr } = await supabaseAdmin
      .from("user_roles")
      .select("id")
      .eq("role", "admin")
      .limit(1);

    if (existingErr) throw new Error(existingErr.message);

    if (existing && existing.length > 0) {
      return { promoted: false, reason: "admin_exists" as const };
    }

    const { error: insertErr } = await supabaseAdmin
      .from("user_roles")
      .insert({ user_id: context.userId, role: "admin" });

    if (insertErr) throw new Error(insertErr.message);

    return { promoted: true, reason: "bootstrapped" as const };
  });
