import type { Session, User } from "@supabase/supabase-js";

import { supabase } from "@/integrations/supabase/client";
import {
  sovereignAuth,
  sovereignAuthEnabled,
  type SovereignSession,
  type SovereignUser,
} from "@/lib/sovereign-auth-client";

export type RonsAuthUser = {
  id: string;
  email?: string | null;
};

export type RonsAuthSession = {
  user: RonsAuthUser;
};

export type RonsAuthResult<T> = {
  data: T;
  error: Error | null;
};

export type RonsAuthSubscription = {
  data: { subscription: { unsubscribe: () => void } };
};
function normalizeUser(user: User | SovereignUser | null | undefined): RonsAuthUser | null {
  if (!user?.id) return null;
  return { id: user.id, email: user.email ?? null };
}

function normalizeHostedSession(session: Session | null): RonsAuthSession | null {
  const user = normalizeUser(session?.user);
  return user ? { user } : null;
}

function normalizeSovereignSession(
  session: SovereignSession | null | undefined,
): RonsAuthSession | null {
  const user = normalizeUser(session?.user);
  return user ? { user } : null;
}

function normalizeError(error: unknown): Error | null {
  if (!error) return null;
  if (error instanceof Error) return error;
  if (typeof error === "object" && error !== null && "message" in error) {
    const message = (error as { message?: unknown }).message;
    if (typeof message === "string") return new Error(message);
  }
  return new Error("Authentication request failed");
}

export function isSovereignClientAuth(): boolean {
  return sovereignAuthEnabled();
}
export const ronsAuth = {
  async getSession(): Promise<RonsAuthResult<{ session: RonsAuthSession | null }>> {
    if (isSovereignClientAuth()) {
      const result = await sovereignAuth.getSession();
      return {
        data: { session: normalizeSovereignSession(result.data?.session) },
        error: result.error,
      };
    }
    const result = await supabase.auth.getSession();
    return {
      data: { session: normalizeHostedSession(result.data.session) },
      error: normalizeError(result.error),
    };
  },

  async getUser(): Promise<RonsAuthResult<{ user: RonsAuthUser | null }>> {
    if (isSovereignClientAuth()) {
      const result = await sovereignAuth.getUser();
      return { data: { user: normalizeUser(result.data?.user) }, error: result.error };
    }
    const result = await supabase.auth.getUser();
    return {
      data: { user: normalizeUser(result.data.user) },
      error: normalizeError(result.error),
    };
  },
  async signInWithPassword(credentials: {
    email: string;
    password: string;
  }): Promise<RonsAuthResult<{ user: RonsAuthUser | null; session: RonsAuthSession | null }>> {
    if (isSovereignClientAuth()) {
      const result = await sovereignAuth.signInWithPassword(credentials);
      return {
        data: {
          user: normalizeUser(result.data?.user),
          session: normalizeSovereignSession(result.data?.session),
        },
        error: result.error,
      };
    }
    const result = await supabase.auth.signInWithPassword(credentials);
    return {
      data: {
        user: normalizeUser(result.data.user),
        session: normalizeHostedSession(result.data.session),
      },
      error: normalizeError(result.error),
    };
  },

  async signUp(credentials: {
    email: string;
    password: string;
    redirectTo?: string;
  }): Promise<RonsAuthResult<{ user: RonsAuthUser | null; session: RonsAuthSession | null }>> {
    if (isSovereignClientAuth()) {
      const result = await sovereignAuth.signUp({
        email: credentials.email,
        password: credentials.password,
      });
      return {
        data: {
          user: normalizeUser(result.data?.user),
          session: normalizeSovereignSession(result.data?.session),
        },
        error: result.error,
      };
    }
    const result = await supabase.auth.signUp({
      email: credentials.email,
      password: credentials.password,
      options: credentials.redirectTo ? { emailRedirectTo: credentials.redirectTo } : undefined,
    });
    return {
      data: {
        user: normalizeUser(result.data.user),
        session: normalizeHostedSession(result.data.session),
      },
      error: normalizeError(result.error),
    };
  },

  async signOut(): Promise<{ error: Error | null }> {
    if (isSovereignClientAuth()) {
      const result = await sovereignAuth.signOut();
      return { error: result.error };
    }
    const result = await supabase.auth.signOut();
    return { error: normalizeError(result.error) };
  },

  onAuthStateChange(callback: (session: RonsAuthSession | null) => void): RonsAuthSubscription {
    if (isSovereignClientAuth()) {
      return { data: { subscription: { unsubscribe: () => undefined } } };
    }
    const subscription = supabase.auth.onAuthStateChange((_event, session) => {
      callback(normalizeHostedSession(session));
    });
    return subscription;
  },

  async signInWithGoogle(redirectTo: string): Promise<{ error: Error | null }> {
    if (isSovereignClientAuth()) {
      return { error: new Error("Google sign-in is unavailable in sovereign local mode") };
    }
    const result = await supabase.auth.signInWithOAuth({
      provider: "google",
      options: { redirectTo },
    });
    return { error: normalizeError(result.error) };
  },
};
