/**
 * Shared sign-out helper — clears Supabase + local entitlement cache and
 * redirects. Every logged-in surface (Hub + spokes) should use this so
 * logout behaves identically across the suite.
 *
 * Never delete saved user projects from cache — only auth + entitlement.
 */
import { supabase } from "@/integrations/supabase/client";

const CACHE_KEY_PATTERNS = [
  /^sb-/,
  /supabase/i,
  /resonance_cached_entitlement/i,
];

export function signOutAndRedirect(redirectTo: string = "/"): void {
  try {
    void supabase.auth
      .signOut({ scope: "local" })
      .catch((e) => console.error("Sign out error:", e));
  } catch (e) {
    console.error("Sign out error:", e);
  }

  try {
    Object.keys(localStorage)
      .filter((k) => CACHE_KEY_PATTERNS.some((rx) => rx.test(k)))
      .forEach((k) => localStorage.removeItem(k));
  } catch {
    /* ignore — SSR / disabled storage */
  }

  if (typeof window !== "undefined") {
    window.location.replace(redirectTo);
  }
}

/** Same cleanup as `signOutAndRedirect` but without sign-out or redirect. */
export function clearLocalEntitlementCache(): void {
  try {
    Object.keys(localStorage)
      .filter((k) => /resonance_cached_entitlement/i.test(k))
      .forEach((k) => localStorage.removeItem(k));
  } catch {
    /* ignore */
  }
}
