import type { AuthChangeEvent, Session } from "@supabase/supabase-js";

type Listener = (event: AuthChangeEvent, session: Session | null) => void | Promise<void>;
const listeners = new Set<Listener>();

export function sovereignAuthEnabled(): boolean {
  return typeof window !== "undefined" && import.meta.env.VITE_RONS_AUTH_MODE === "sovereign";
}

async function request(action: string, init: RequestInit = {}) {
  const response = await fetch(`/api/sovereign/auth/${action}`, {
    credentials: "include",
    headers: { Accept: "application/json", ...(init.headers ?? {}) },
    ...init,
  });
  let body: any = null;
  try { body = await response.json(); } catch { body = null; }
  if (!response.ok) {
    return { data: body ?? {}, error: new Error(body?.error ?? `Auth request failed (${response.status})`) };
  }
  return { data: body ?? {}, error: null };
}

async function emit(event: AuthChangeEvent, session: Session | null) {
  for (const listener of listeners) await listener(event, session);
}

export const sovereignAuth = {
  async getSession() {
    const result = await request("session");
    return { data: { session: result.data?.session ?? null }, error: result.error };
  },
  async getUser() {
    const result = await request("user");
    return { data: { user: result.data?.user ?? null }, error: result.error };
  },  onAuthStateChange(callback: Listener) {
    listeners.add(callback);
    void this.getSession().then(({ data }) => callback("INITIAL_SESSION", data.session));
    return { data: { subscription: { unsubscribe: () => listeners.delete(callback) } } } as any;
  },
  async signInWithPassword(credentials: { email: string; password: string }) {
    const result = await request("sign-in", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(credentials),
    });
    if (!result.error) await emit("SIGNED_IN", result.data?.session ?? null);
    return result;
  },
  async signUp(credentials: { email: string; password: string; options?: unknown }) {
    const result = await request("sign-up", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email: credentials.email, password: credentials.password }),
    });
    if (!result.error && result.data?.session) await emit("SIGNED_IN", result.data.session);
    return result;
  },  async signOut() {
    const result = await request("sign-out", { method: "POST" });
    if (!result.error) await emit("SIGNED_OUT", null);
    return { error: result.error };
  },
  async signInWithOAuth() {
    return {
      data: { provider: null, url: null },
      error: new Error("OAuth is disabled in sovereign production mode."),
    };
  },
};