import { createStart, createMiddleware, createCsrfMiddleware } from "@tanstack/react-start";
import { getRequest } from "@tanstack/react-start/server";

import { renderErrorPage } from "./lib/error-page";
import { attachSupabaseAuth } from "@/integrations/supabase/auth-attacher";

const csrfMiddleware = createCsrfMiddleware({
  filter: (ctx) => ctx.handlerType === "serverFn",
});

const errorMiddleware = createMiddleware().server(async ({ next, request }) => {
  try {
    return await next();
  } catch (error) {
    if (error != null && typeof error === "object" && "statusCode" in error) {
      throw error;
    }
    console.error(error);
    // Let TanStack's serverFn handler format its own error envelope; a raw
    // HTML fallback would break the RPC client and blank the page.
    const activeRequest = request ?? getRequest();
    const url = activeRequest?.url ?? "";
    const isServerFn =
      url.includes("/_serverFn/") ||
      activeRequest?.headers?.get("x-tsr-serverFn")?.toLowerCase() === "true";
    if (isServerFn) {
      throw error;
    }
    return new Response(renderErrorPage(), {
      status: 500,
      headers: { "content-type": "text/html; charset=utf-8" },
    });
  }
});

export const startInstance = createStart(() => ({
  requestMiddleware: [csrfMiddleware, errorMiddleware],
  functionMiddleware: [attachSupabaseAuth],
}));
