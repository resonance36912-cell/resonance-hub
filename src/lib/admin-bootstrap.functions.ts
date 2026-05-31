import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { supabaseAdmin } from "@/integrations/supabase/client.server";

/**
 * Bootstrap an admin: if the user_roles table contains NO admin rows yet,
 * grant the currently signed-in user the admin role — BUT ONLY when their
 * email is in the server-side `ADMIN_BOOTSTRAP_EMAILS` allowlist (comma-
 * separated). Without that env var, this function is a no-op, which closes
 * the first-user privilege-escalation race: an attacker who signs up before
 * the legitimate admin on a fresh deploy can no longer claim admin rights.
 *
 * Once any admin exists, this is a no-op regardless of env.
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

    const allowlistRaw = process.env.ADMIN_BOOTSTRAP_EMAILS ?? "";
    const allowlist = allowlistRaw
      .split(",")
      .map((s) => s.trim().toLowerCase())
      .filter(Boolean);

    if (allowlist.length === 0) {
      return { promoted: false, reason: "bootstrap_disabled" as const };
    }

    const claimEmail =
      typeof (context.claims as Record<string, unknown>).email === "string"
        ? ((context.claims as Record<string, unknown>).email as string).toLowerCase()
        : null;

    if (!claimEmail || !allowlist.includes(claimEmail)) {
      return { promoted: false, reason: "not_allowlisted" as const };
    }

    const { error: insertErr } = await supabaseAdmin
      .from("user_roles")
      .insert({ user_id: context.userId, role: "admin" });

    if (insertErr) throw new Error(insertErr.message);

    return { promoted: true, reason: "bootstrapped" as const };
  });
