import { supabase } from "@/integrations/supabase/client";
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
  return typeof window !== "undefined" && import.meta.env.VITE_RONS_AUTH_SHADOW === "1";
}
async function shadowRead(
  action: "session" | "user",
  authoritativeUserId: string | null | undefined,
): Promise<void> {
  if (!shadowEnabled()) return;
  try {
    const response = await fetch(`/api/sovereign/auth/${action}`, {
      method: "GET",
      credentials: "include",
      headers: { Accept: "application/json" },
    });
    let sovereignUserId: string | null = null;
    if (response.ok) {
      const body = (await response.json()) as {
        user?: { id?: string };
        session?: { user?: { id?: string } } | null;
      };
      sovereignUserId = body.user?.id ?? body.session?.user?.id ?? null;
    }
    console.info("[RONS auth shadow]", {
      action,
      ...compareAuthShadow(authoritativeUserId, sovereignUserId),
    });
  } catch {
    console.info("[RONS auth shadow]", { action, unavailable: true });
  }
}
export const ronsAuth = {
  async getSession() {
    const result = await supabase.auth.getSession();
    void shadowRead("session", result.data.session?.user?.id);
    return result;
  },
  async getUser(jwt?: string) {
    const result = jwt ? await supabase.auth.getUser(jwt) : await supabase.auth.getUser();
    void shadowRead("user", result.data.user?.id);
    return result;
  },
  onAuthStateChange(callback: (event: AuthChangeEvent, session: Session | null) => void | Promise<void>) {
    return supabase.auth.onAuthStateChange(async (event, session) => {
      void shadowRead("session", session?.user?.id);
      await callback(event, session);
    });
  },
  signInWithPassword(credentials: Parameters<typeof supabase.auth.signInWithPassword>[0]) {
    return supabase.auth.signInWithPassword(credentials);
  },
  signUp(credentials: Parameters<typeof supabase.auth.signUp>[0]) {
    return supabase.auth.signUp(credentials);
  },
  signOut(options?: Parameters<typeof supabase.auth.signOut>[0]) {
    return supabase.auth.signOut(options);
  },
  signInWithOAuth(credentials: Parameters<typeof supabase.auth.signInWithOAuth>[0]) {
    return supabase.auth.signInWithOAuth(credentials);
  },
};
