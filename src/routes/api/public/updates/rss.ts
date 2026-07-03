import { createFileRoute } from "@tanstack/react-router";
import { getRequestHost, getRequestUrl } from "@tanstack/react-start/server";

type UpdateLink = { label: string; href: string };
type UpdateItem = {
  app: string;
  status: string;
  tone: string;
  change: string;
  date: string;
  href: string;
  cta: string;
  details?: string;
  links?: UpdateLink[];
};

const MONTHS: Record<string, number> = {
  jan: 0, feb: 1, mar: 2, apr: 3, may: 4, jun: 5,
  jul: 6, aug: 7, sep: 8, sept: 8, oct: 9, nov: 10, dec: 11,
};

// Accepts "Jun 2026", "June 2026", "2026-06-15", or an ISO date.
// Returns the first of that month at 09:00 UTC when the day is missing so
// items keep a stable order.
function parseDate(input: string): Date {
  const iso = new Date(input);
  if (!Number.isNaN(iso.getTime()) && /\d{4}-\d{2}/.test(input)) return iso;
  const m = input.trim().match(/^([A-Za-z]+)\s+(\d{4})$/);
  if (m) {
    const monthIdx = MONTHS[m[1].toLowerCase()];
    if (typeof monthIdx === "number") {
      return new Date(Date.UTC(Number(m[2]), monthIdx, 1, 9, 0, 0));
    }
  }
  if (!Number.isNaN(iso.getTime())) return iso;
  return new Date();
}

function escapeXml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

function absolutize(href: string, origin: string): string {
  if (/^https?:\/\//i.test(href)) return href;
  if (href.startsWith("/")) return `${origin}${href}`;
  return `${origin}/${href}`;
}

// Stable per-item GUID so readers don't re-notify on republish.
function guidFor(u: UpdateItem, origin: string): string {
  const slug = u.app.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
  const dateKey = parseDate(u.date).toISOString().slice(0, 7); // YYYY-MM
  return `${origin}/updates/${slug}/${dateKey}`;
}

function isValid(u: unknown): u is UpdateItem {
  if (!u || typeof u !== "object") return false;
  const o = u as Record<string, unknown>;
  return (
    typeof o.app === "string" &&
    typeof o.status === "string" &&
    typeof o.tone === "string" &&
    typeof o.change === "string" &&
    typeof o.date === "string" &&
    typeof o.href === "string" &&
    typeof o.cta === "string"
  );
}

async function loadUpdates(origin: string): Promise<UpdateItem[]> {
  const res = await fetch(`${origin}/content/updates.json`, {
    headers: { accept: "application/json" },
  });
  if (!res.ok) throw new Error(`Failed to load updates.json: ${res.status}`);
  const data = (await res.json()) as unknown;
  if (!Array.isArray(data)) return [];
  return data.filter(isValid);
}

function buildRss(updates: UpdateItem[], origin: string): string {
  const feedUrl = `${origin}/api/public/updates.rss`;
  const siteUrl = `${origin}/`;
  const now = new Date().toUTCString();

  const items = [...updates]
    .sort((a, b) => parseDate(b.date).getTime() - parseDate(a.date).getTime())
    .map((u) => {
      const link = absolutize(u.href, origin);
      const guid = guidFor(u, origin);
      const pubDate = parseDate(u.date).toUTCString();
      const descriptionParts: string[] = [`<p>${escapeXml(u.change)}</p>`];
      if (u.details) {
        for (const para of u.details.split(/\n{2,}/)) {
          descriptionParts.push(`<p>${escapeXml(para)}</p>`);
        }
      }
      if (u.links && u.links.length > 0) {
        const lis = u.links
          .map((l) => `<li><a href="${escapeXml(absolutize(l.href, origin))}">${escapeXml(l.label)}</a></li>`)
          .join("");
        descriptionParts.push(`<p><strong>Links:</strong></p><ul>${lis}</ul>`);
      }
      const descriptionHtml = descriptionParts.join("");
      return [
        "    <item>",
        `      <title>${escapeXml(`${u.app} — ${u.status}`)}</title>`,
        `      <link>${escapeXml(link)}</link>`,
        `      <guid isPermaLink="false">${escapeXml(guid)}</guid>`,
        `      <pubDate>${pubDate}</pubDate>`,
        `      <category>${escapeXml(u.app)}</category>`,
        `      <category>${escapeXml(u.status)}</category>`,
        `      <description><![CDATA[${descriptionHtml}]]></description>`,
        "    </item>",
      ].join("\n");
    })
    .join("\n");

  return [
    '<?xml version="1.0" encoding="UTF-8"?>',
    '<rss version="2.0" xmlns:atom="http://www.w3.org/2005/Atom">',
    "  <channel>",
    "    <title>Resonance — Latest Updates</title>",
    `    <link>${escapeXml(siteUrl)}</link>`,
    "    <description>Release notes and status changes across the Resonance ecosystem: Hub, ePublisher, Creative Studio, Sync Vision, YouTube Optimizer, Career Compass, and the Resonance Podcast.</description>",
    "    <language>en</language>",
    `    <lastBuildDate>${now}</lastBuildDate>`,
    `    <atom:link href="${escapeXml(feedUrl)}" rel="self" type="application/rss+xml" />`,
    items,
    "  </channel>",
    "</rss>",
  ].join("\n");
}

export const Route = createFileRoute("/api/public/updates/rss")({
  server: {
    handlers: {
      GET: async () => {
        const host = getRequestHost();
        const proto = getRequestUrl().protocol.replace(":", "") || "https";
        const origin = `${proto}://${host}`;
        try {
          const updates = await loadUpdates(origin);
          const xml = buildRss(updates, origin);
          return new Response(xml, {
            status: 200,
            headers: {
              "content-type": "application/rss+xml; charset=utf-8",
              // Small cache — feed changes only when updates.json changes.
              "cache-control": "public, max-age=300, s-maxage=300",
            },
          });
        } catch (err) {
          return new Response(
            `<?xml version="1.0" encoding="UTF-8"?>\n<error>${escapeXml(String((err as Error).message ?? err))}</error>`,
            { status: 500, headers: { "content-type": "application/xml" } },
          );
        }
      },
    },
  },
});
