import { createServerFn } from "@tanstack/react-start";
import { getRequest } from "@tanstack/react-start/server";
import { resolveRequestOrigin } from "@/lib/request-origin";

export const getRequestOrigin = createServerFn({ method: "GET" }).handler(() => {
  const req = getRequest();
  return resolveRequestOrigin(req, process.env.RAILWAY_PUBLIC_DOMAIN);
});
