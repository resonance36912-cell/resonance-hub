// Shared HTTP caching helpers for public feed endpoints (RSS, Atom).
// Runs in the server runtime (Cloudflare Worker); uses Web Crypto for hashing.

export type FeedCacheHeaders = {
  etag: string;
  lastModified: string;
  cacheControl: string;
};

const CACHE_CONTROL =
  // Fresh for 5 min to end clients / CDNs, servable stale while revalidating
  // for another 10 min so a spike of reader polls hits cache rather than
  // regenerating XML. Must-revalidate keeps 304 semantics honest.
  "public, max-age=300, s-maxage=300, stale-while-revalidate=600, must-revalidate";

// Weak ETag derived from the full response body — cheap to compute, and
// changes iff the rendered feed changes (so filter params, ordering, and
// content edits all bust it).
export async function computeFeedHeaders(
  body: string,
  latestItemDate: Date | null,
): Promise<FeedCacheHeaders> {
  const data = new TextEncoder().encode(body);
  const digest = await crypto.subtle.digest("SHA-1", data);
  const hex = Array.from(new Uint8Array(digest))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
  const etag = `W/"${hex.slice(0, 27)}"`;
  const lastModified = (latestItemDate ?? new Date()).toUTCString();
  return { etag, lastModified, cacheControl: CACHE_CONTROL };
}

// Trim quotes/whitespace so a weak ETag still matches after passing through
// intermediaries.
function normalizeEtag(v: string): string {
  return v.trim().replace(/^W\//i, "").replace(/^"|"$/g, "");
}

export function matchesConditional(
  request: Request,
  headers: FeedCacheHeaders,
): boolean {
  const inm = request.headers.get("if-none-match");
  if (inm) {
    const want = normalizeEtag(headers.etag);
    const seen = inm
      .split(",")
      .map((s) => normalizeEtag(s))
      .filter(Boolean);
    if (seen.includes(want) || seen.includes("*")) return true;
  }
  const ims = request.headers.get("if-modified-since");
  if (ims) {
    const since = Date.parse(ims);
    const mod = Date.parse(headers.lastModified);
    if (Number.isFinite(since) && Number.isFinite(mod) && mod <= since) {
      return true;
    }
  }
  return false;
}

// Headers to attach to the 304 response so intermediaries keep caching.
export function notModifiedHeaders(headers: FeedCacheHeaders): HeadersInit {
  return {
    etag: headers.etag,
    "last-modified": headers.lastModified,
    "cache-control": headers.cacheControl,
    vary: "Accept, Accept-Encoding",
  };
}
