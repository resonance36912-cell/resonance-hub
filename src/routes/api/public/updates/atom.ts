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

function guidFor(u: UpdateItem, origin: string): string {
  const slug = u.app.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
  const dateKey = parseDate(u.date).toISOString().slice(0, 7);
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

const ALLOWED_STATUSES = ["Live", "Updating", "New", "Free Pilot"] as const;

function parseStatusFilter(raw: string | null): string[] {
  if (!raw) return [];
  const wanted = raw
    .split(",")
    .map((s) => s.trim().toLowerCase())
    .filter(Boolean);
  const allowed = new Set(ALLOWED_STATUSES.map((s) => s.toLowerCase()));
  return wanted.filter((s) => allowed.has(s));
}

function applyStatusFilter(updates: UpdateItem[], statuses: string[]): UpdateItem[] {
  if (statuses.length === 0) return updates;
  const set = new Set(statuses);
  return updates.filter((u) => set.has(u.status.toLowerCase()));
}

function buildAtom(
  updates: UpdateItem[],
  origin: string,
  statusFilter: string[],
): string {
  const qs = statusFilter.length > 0 ? `?status=${encodeURIComponent(statusFilter.join(","))}` : "";
  const feedUrl = `${origin}/api/public/updates/atom${qs}`;
  const siteUrl = `${origin}/`;
  const titleSuffix =
    statusFilter.length > 0
      ? ` (${statusFilter.map((s) => s.replace(/\b\w/g, (c) => c.toUpperCase())).join(", ")})`
      : "";
  const sorted = [...updates].sort(
    (a, b) => parseDate(b.date).getTime() - parseDate(a.date).getTime(),
  );
  const updatedIso = (sorted[0] ? parseDate(sorted[0].date) : new Date()).toISOString();


  const entries = sorted
    .map((u) => {
      const link = absolutize(u.href, origin);
      const id = guidFor(u, origin);
      const updated = parseDate(u.date).toISOString();
      const parts: string[] = [`<p>${escapeXml(u.change)}</p>`];
      if (u.details) {
        for (const para of u.details.split(/\n{2,}/)) {
          parts.push(`<p>${escapeXml(para)}</p>`);
        }
      }
      if (u.links && u.links.length > 0) {
        const lis = u.links
          .map((l) => `<li><a href="${escapeXml(absolutize(l.href, origin))}">${escapeXml(l.label)}</a></li>`)
          .join("");
        parts.push(`<p><strong>Links:</strong></p><ul>${lis}</ul>`);
      }
      const contentHtml = parts.join("");
      return [
        "  <entry>",
        `    <title>${escapeXml(`${u.app} — ${u.status}`)}</title>`,
        `    <id>${escapeXml(id)}</id>`,
        `    <link rel="alternate" type="text/html" href="${escapeXml(link)}" />`,
        `    <updated>${updated}</updated>`,
        `    <published>${updated}</published>`,
        `    <category term="${escapeXml(u.app)}" />`,
        `    <category term="${escapeXml(u.status)}" />`,
        `    <summary>${escapeXml(u.change)}</summary>`,
        `    <content type="html"><![CDATA[${contentHtml}]]></content>`,
        "  </entry>",
      ].join("\n");
    })
    .join("\n");

  return [
    '<?xml version="1.0" encoding="UTF-8"?>',
    '<feed xmlns="http://www.w3.org/2005/Atom">',
    "  <title>Resonance — Latest Updates</title>",
    "  <subtitle>Release notes and status changes across the Resonance ecosystem: Hub, ePublisher, Creative Studio, Sync Vision, YouTube Optimizer, Career Compass, and the Resonance Podcast.</subtitle>",
    `  <link rel="self" type="application/atom+xml" href="${escapeXml(feedUrl)}" />`,
    `  <link rel="alternate" type="text/html" href="${escapeXml(siteUrl)}" />`,
    `  <id>${escapeXml(feedUrl)}</id>`,
    `  <updated>${updatedIso}</updated>`,
    "  <author><name>Resonance</name></author>",
    entries,
    "</feed>",
  ].join("\n");
}

export const Route = createFileRoute("/api/public/updates/atom")({
  server: {
    handlers: {
      GET: async () => {
        const host = getRequestHost();
        const proto = getRequestUrl().protocol.replace(":", "") || "https";
        const origin = `${proto}://${host}`;
        try {
          const updates = await loadUpdates(origin);
          const xml = buildAtom(updates, origin);
          return new Response(xml, {
            status: 200,
            headers: {
              "content-type": "application/atom+xml; charset=utf-8",
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
