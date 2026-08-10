import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

// -----------------------------------------------------------------------------
// Read-only admin access diagnostics.
// Reports whether the CALLER holds the admin role and how first-admin bootstrap
// is configured. Deliberately never returns the contents of the
// ADMIN_BOOTSTRAP_EMAILS allowlist — only whether it is set and whether the
// caller's own verified email matches it.
// -----------------------------------------------------------------------------

export type AdminAccessStatus = {
  email: string | null;
  emailVerified: boolean;
  roles: string[];
  isAdmin: boolean;
  anyAdminExists: boolean;
  bootstrapConfigured: boolean;
  bootstrapEntryCount: number;
  selfAllowlisted: boolean;
};

export const getAdminAccessStatus = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }): Promise<AdminAccessStatus> => {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

    const claims = context.claims as Record<string, unknown>;
    const email = typeof claims.email === "string" ? claims.email.toLowerCase() : null;
    const emailVerified =
      claims.email_verified === true ||
      typeof claims.email_confirmed_at === "string" ||
      (typeof claims.user_metadata === "object" &&
        claims.user_metadata !== null &&
        (claims.user_metadata as Record<string, unknown>).email_verified === true);

    // Caller's own roles.
    const { data: myRoles, error: myRolesErr } = await supabaseAdmin
      .from("user_roles")
      .select("role")
      .eq("user_id", context.userId);
    if (myRolesErr) throw new Error(myRolesErr.message);
    const roles = (myRoles ?? []).map((r) => String(r.role)).sort();

    // Does ANY admin exist? Bootstrap is a no-op once one does.
    const { count, error: countErr } = await supabaseAdmin
      .from("user_roles")
      .select("id", { count: "exact", head: true })
      .eq("role", "admin");
    if (countErr) throw new Error(countErr.message);

    const allowlist = (process.env["ADMIN_BOOTSTRAP_EMAILS"] ?? "")
      .split(",")
      .map((s) => s.trim().toLowerCase())
      .filter(Boolean);

    return {
      email,
      emailVerified: Boolean(emailVerified),
      roles,
      isAdmin: roles.includes("admin"),
      anyAdminExists: (count ?? 0) > 0,
      bootstrapConfigured: allowlist.length > 0,
      bootstrapEntryCount: allowlist.length,
      selfAllowlisted: Boolean(email && allowlist.includes(email)),
    };
  });
