import { supabase } from "@/integrations/supabase/client";
import { sovereignAuth, sovereignAuthEnabled } from "@/lib/sovereign-auth-client";
import type { AuthChangeEvent, Session } from "@supabase/supabase-js";

export type AuthShadowComparison = {
  authoritativeAuthenticated: boolean;
  sovereignAuthenticated: boolean;
  identityMatch: boolean;
};

export function compareAuthShadow(
  authoritativeUserId: string | null | undefined,
  sovereignUserId: string | null | undefined,
): AuthShadowComparison {
  return {
    authoritativeAuthenticated: Boolean(authoritativeUserId),
    sovereignAuthenticated: Boolean(sovereignUserId),
    identityMatch: Boolean(authoritativeUserId && sovereignUserId && authoritativeUserId === sovereignUserId),
  };
}

function shadowEnabled(): boolean {
  return !sovereignAuthEnabled() && typeof window !== "undefined" && import.meta.env.VITE_RONS_AUTH_SHADOW === "1";
}

async function sovereignShadowUserId(action: "session" | "user"): Promise<string | null> {
  const response = await fetch(`/api/sovereign/auth/${action}`, {
    method: "GET", credentials: "include", headers: { Accept: "application/json" },
  });  if (!response.ok) return null;
  const body = (await response.json()) as { user?: { id?: string }; session?: { user?: { id?: string } } | null };
  return body.user?.id ?? body.session?.user?.id ?? null;
}

async function shadowRead(
  action: "session" | "user",
  authoritativeUserId: string | null | undefined,
  authoritativeAccessToken?: string | null,
): Promise<void> {
  if (!shadowEnabled()) return;
  try {
    let sovereignUserId = await sovereignShadowUserId(action);
    if (!sovereignUserId && authoritativeUserId && authoritativeAccessToken) {
      const exchange = await fetch("/api/sovereign/auth/exchange", {
        method: "POST", credentials: "include",
        headers: { Accept: "application/json", Authorization: `Bearer ${authoritativeAccessToken}` },
      });
      if (exchange.ok) {
        const body = (await exchange.json()) as { user?: { id?: string } };
        sovereignUserId = body.user?.id ?? null;
      }
    }
    console.info("[RONS auth shadow]", { action, ...compareAuthShadow(authoritativeUserId, sovereignUserId) });
  } catch {
    console.info("[RONS auth shadow]", { action, unavailable: true });
  }
}
export const ronsAuth = {
  async getSession() {
    if (sovereignAuthEnabled()) return sovereignAuth.getSession() as any;
    const result = await supabase.auth.getSession();
    void shadowRead("session", result.data.session?.user?.id, result.data.session?.access_token);
    return result;
  },
  async getUser(jwt?: string) {
    if (sovereignAuthEnabled()) return sovereignAuth.getUser() as any;
    const result = jwt ? await supabase.auth.getUser(jwt) : await supabase.auth.getUser();
    void shadowRead("user", result.data.user?.id, jwt);
    return result;
  },
  onAuthStateChange(callback: (event: AuthChangeEvent, session: Session | null) => void | Promise<void>) {
    if (sovereignAuthEnabled()) return sovereignAuth.onAuthStateChange(callback) as any;
    return supabase.auth.onAuthStateChange(async (event, session) => {
      void shadowRead("session", session?.user?.id, session?.access_token);
      await callback(event, session);
    });
  },
  signInWithPassword(credentials: Parameters<typeof supabase.auth.signInWithPassword>[0]) {
    if (sovereignAuthEnabled()) return sovereignAuth.signInWithPassword(credentials as any) as any;
    return supabase.auth.signInWithPassword(credentials);
  },
  signUp(credentials: Parameters<typeof supabase.auth.signUp>[0]) {
    if (sovereignAuthEnabled()) return sovereignAuth.signUp(credentials as any) as any;
    return supabase.auth.signUp(credentials);
  },  async signOut(options?: Parameters<typeof supabase.auth.signOut>[0]) {
    if (sovereignAuthEnabled()) return sovereignAuth.signOut() as any;
    const result = await supabase.auth.signOut(options);
    if (!result.error && shadowEnabled()) {
      try {
        await fetch("/api/sovereign/auth/sign-out", { method: "POST", credentials: "include" });
      } catch { /* shadow cleanup is non-authoritative */ }
    }
    return result;
  },
  signInWithOAuth(credentials: Parameters<typeof supabase.auth.signInWithOAuth>[0]) {
    if (sovereignAuthEnabled()) return sovereignAuth.signInWithOAuth() as any;
    return supabase.auth.signInWithOAuth(credentials);
  },
};