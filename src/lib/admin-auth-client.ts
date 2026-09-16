import { redirect } from "@tanstack/react-router";
import { getCurrentAdminAccess } from "@/lib/admin-access.functions";
import { ronsAuth } from "@/lib/auth-provider";

export async function requireAdminRoute(): Promise<void> {
  const access = await getCurrentAdminAccess();
  if (!access.authenticated) throw redirect({ to: "/admin/login" });
  if (!access.isAdmin) throw redirect({ to: "/admin/access" });
}

export async function redirectAuthenticatedAdmin(): Promise<void> {
  const access = await getCurrentAdminAccess();
  if (!access.authenticated) return;
  if (access.isAdmin) throw redirect({ to: "/admin" });
  throw redirect({ to: "/admin/access" });
}

export async function signOutAdmin(): Promise<void> {
  const { error } = await ronsAuth.signOut();
  if (error) throw error;
}
