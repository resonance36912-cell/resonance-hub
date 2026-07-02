// Shared caller-key check for internal ROP cron endpoints.
// Requires callers to present the service-role key as `Authorization: Bearer <key>`.
// pg_cron / internal callers already have this secret; the public internet does not.
export function assertCronAuthorized(request: Request): Response | null {
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!serviceKey) {
    return Response.json({ error: "Server configuration error" }, { status: 500 });
  }
  const authHeader = request.headers.get("Authorization");
  if (!authHeader?.startsWith("Bearer ")) {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }
  const token = authHeader.slice("Bearer ".length).trim();
  if (token !== serviceKey) {
    return Response.json({ error: "Forbidden" }, { status: 403 });
  }
  return null;
}
