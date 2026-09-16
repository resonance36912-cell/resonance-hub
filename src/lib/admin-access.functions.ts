import { createServerFn } from "@tanstack/react-start";
import { getRequest } from "@tanstack/react-start/server";
import { hasServerBackendRole } from "@/lib/backend-provider.server";
import { resolveRonsRequestCredential, resolveRonsRequestUser } from "@/lib/rons-auth-middleware";

export type CurrentAdminAccess = {
  authenticated: boolean;
  isAdmin: boolean;
  userId: string | null;
  email: string | null;
};

export const getCurrentAdminAccess = createServerFn({ method: "GET" }).handler(
  async (): Promise<CurrentAdminAccess> => {
    const request = getRequest();
    if (!request?.headers || !resolveRonsRequestCredential(request)) {
      return { authenticated: false, isAdmin: false, userId: null, email: null };
    }
    const user = await resolveRonsRequestUser(request);
    if (!user) return { authenticated: false, isAdmin: false, userId: null, email: null };
    const credential = resolveRonsRequestCredential(request);
    if (!credential) return { authenticated: false, isAdmin: false, userId: null, email: null };
    const isAdmin = await hasServerBackendRole(user.id, "admin", credential);
    return { authenticated: true, isAdmin, userId: user.id, email: user.email };
  },
);
