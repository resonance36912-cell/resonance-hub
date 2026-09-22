/** Resolve the visitor-facing origin without trusting forwarded host headers. */
export function resolveRequestOrigin(request: Request, railwayPublicDomain?: string): string {
  const domain = railwayPublicDomain?.trim();
  if (domain) {
    const publicUrl = new URL(`https://${domain}`);
    if (publicUrl.host !== domain || publicUrl.pathname !== "/" || publicUrl.search || publicUrl.hash || publicUrl.username || publicUrl.password) {
      throw new Error("Invalid Railway public domain");
    }
    return publicUrl.origin;
  }

  const proto = request.headers.get("x-forwarded-proto")?.split(",")[0]?.trim();
  const protocol = proto === "http" || proto === "https" ? proto : new URL(request.url).protocol.slice(0, -1);
  const host = request.headers.get("host") || new URL(request.url).host;
  return `${protocol}://${host}`;
}
