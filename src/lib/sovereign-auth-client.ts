export type SovereignUser = {
  id: string;
  email?: string | null;
};

export type SovereignSession = {
  user?: SovereignUser;
  local?: boolean;
  token_transport?: "httpOnly-cookie" | string;
  expires_in?: number;
};

type SovereignPayload = {
  user?: SovereignUser | null;
  session?: SovereignSession | null;
  ok?: boolean;
};

type SovereignResult<T> = {
  data: T | null;
  error: Error | null;
  status: number;
};

let lastShadowAccessToken = "";
export function sovereignAuthEnabled(): boolean {
  return typeof window !== "undefined" && import.meta.env.VITE_RONS_AUTH_MODE === "sovereign";
}

export function sovereignAuthShadowEnabled(): boolean {
  return (
    typeof window !== "undefined" &&
    !sovereignAuthEnabled() &&
    import.meta.env.VITE_RONS_AUTH_SHADOW === "1"
  );
}

async function request<T extends SovereignPayload>(
  action: string,
  init: RequestInit = {},
): Promise<SovereignResult<T>> {
  const response = await fetch(`/api/sovereign/auth/${action}`, {
    credentials: "include",
    headers: { Accept: "application/json", ...(init.headers ?? {}) },
    ...init,
  });
  let body: T | null = null;
  try {
    body = (await response.json()) as T;
  } catch {
    body = null;
  }
  if (!response.ok) {
    const message =
      body && "error" in body && typeof body.error === "string"
        ? body.error
        : `Sovereign auth request failed (${response.status})`;
    return { data: body, error: new Error(message), status: response.status };
  }
  return { data: body, error: null, status: response.status };
}

export async function exchangeHostedSession(
  accessToken: string,
): Promise<SovereignResult<SovereignPayload>> {
  return request<SovereignPayload>("exchange", {
    method: "POST",
    headers: { Authorization: `Bearer ${accessToken}` },
  });
}

export async function syncSovereignAuthShadow(
  accessToken: string,
  hostedUserId: string,
): Promise<void> {
  if (!sovereignAuthShadowEnabled() || !accessToken || accessToken === lastShadowAccessToken)
    return;
  lastShadowAccessToken = accessToken;
  try {
    const result = await exchangeHostedSession(accessToken);
    if (result.error) {
      lastShadowAccessToken = "";
      console.info("[RONS auth shadow]", { available: false });
      return;
    }
    const sovereignUserId = result.data?.user?.id ?? null;
    console.info("[RONS auth shadow]", {
      available: true,
      authenticated: Boolean(sovereignUserId),
      identityMatch: Boolean(sovereignUserId && sovereignUserId === hostedUserId),
    });
  } catch {
    lastShadowAccessToken = "";
    console.info("[RONS auth shadow]", { available: false });
  }
}

export const sovereignAuth = {
  getSession: () => request<SovereignPayload>("session"),
  getUser: () => request<SovereignPayload>("user"),
  signInWithPassword: (credentials: { email: string; password: string }) =>
    request<SovereignPayload>("sign-in", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(credentials),
    }),
  signUp: (credentials: { email: string; password: string }) =>
    request<SovereignPayload>("sign-up", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(credentials),
    }),
  signOut: () => request<SovereignPayload>("sign-out", { method: "POST" }),
};
