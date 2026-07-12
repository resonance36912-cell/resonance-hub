/**
 * Shared validation helpers for /apps/submit — slug derivation, URL format
 * checks, and reserved slug/host sets pulled from the canonical registries.
 * Used by both the client form (inline feedback) and the server function
 * (authoritative enforcement).
 */
import {
  APP_REGISTRY,
  ECOSYSTEM_REGISTRY,
  BANNED_LEGACY_URLS,
} from "@/lib/app-registry";

export function slugify(input: string): string {
  return input
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 60);
}

/** Registered domain, lowercased, with leading `www.` stripped. */
export function normalizeHost(hostname: string): string {
  return hostname.toLowerCase().replace(/^www\./, "");
}

const IPV4 = /^(?:\d{1,3}\.){3}\d{1,3}$/;

export type UrlValidationResult =
  | { ok: true; normalizedUrl: string; host: string }
  | { ok: false; reason: string };

export function validateAppUrl(raw: string): UrlValidationResult {
  const trimmed = raw.trim();
  if (!trimmed) return { ok: false, reason: "URL is required." };
  let u: URL;
  try {
    u = new URL(trimmed);
  } catch {
    return { ok: false, reason: "Enter a full URL, e.g. https://your-app.example.com" };
  }
  if (u.protocol !== "https:") {
    return { ok: false, reason: "URL must use https://." };
  }
  const host = u.hostname.toLowerCase();
  if (!host.includes(".")) {
    return { ok: false, reason: "URL must include a real domain (with a dot)." };
  }
  if (host === "localhost" || host.endsWith(".localhost")) {
    return { ok: false, reason: "Localhost URLs are not allowed." };
  }
  if (IPV4.test(host) || host.includes(":")) {
    return { ok: false, reason: "Use a domain name, not an IP address." };
  }
  if (u.username || u.password) {
    return { ok: false, reason: "URL must not contain credentials." };
  }
  const normalized = `${u.protocol}//${host}${u.pathname === "/" ? "" : u.pathname}${u.search}`;
  return { ok: true, normalizedUrl: normalized, host: normalizeHost(host) };
}

function collectReservedHosts(): Set<string> {
  const hosts = new Set<string>();
  for (const app of Object.values(APP_REGISTRY)) {
    for (const url of [app.url, app.fallbackUrl].filter(Boolean) as string[]) {
      try {
        hosts.add(normalizeHost(new URL(url).hostname));
      } catch {
        /* ignore */
      }
    }
  }
  for (const eco of Object.values(ECOSYSTEM_REGISTRY)) {
    try {
      hosts.add(normalizeHost(new URL(eco.url).hostname));
    } catch {
      /* ignore */
    }
  }
  for (const banned of BANNED_LEGACY_URLS) hosts.add(normalizeHost(banned));
  return hosts;
}

function collectReservedSlugs(): Set<string> {
  const slugs = new Set<string>();
  for (const app of Object.values(APP_REGISTRY)) {
    slugs.add(app.key);
    slugs.add(slugify(app.label));
  }
  for (const eco of Object.values(ECOSYSTEM_REGISTRY)) {
    slugs.add(eco.key);
    slugs.add(slugify(eco.label));
  }
  // Route/reserved words we don't want colliding with catalog paths.
  for (const w of ["apps", "submit", "admin", "account", "pricing", "checkout", "auth", "api", "hub"]) {
    slugs.add(w);
  }
  return slugs;
}

export const RESERVED_HOSTS = collectReservedHosts();
export const RESERVED_SLUGS = collectReservedSlugs();

export function isReservedSlug(slug: string): boolean {
  return RESERVED_SLUGS.has(slug);
}

export function isReservedHost(host: string): boolean {
  return RESERVED_HOSTS.has(normalizeHost(host));
}
