import { createFileRoute } from "@tanstack/react-router";
import type {} from "@tanstack/react-start";
import { APP_REGISTRY } from "@/lib/app-registry";

const BASE_URL = "https://reson8.life";

interface SitemapEntry {
  loc: string;
  lastmod?: string;
  changefreq?: "always" | "hourly" | "daily" | "weekly" | "monthly" | "yearly" | "never";
  priority?: string;
}

export const Route = createFileRoute("/sitemap.xml")({
  server: {
    handlers: {
      GET: async () => {
        const today = new Date().toISOString().split("T")[0];

        const hubEntries: SitemapEntry[] = [
          { loc: `${BASE_URL}/`, changefreq: "weekly", priority: "1.0", lastmod: today },
          { loc: `${BASE_URL}/pricing`, changefreq: "monthly", priority: "0.9", lastmod: today },
          { loc: `${BASE_URL}/apps`, changefreq: "weekly", priority: "0.9", lastmod: today },
          { loc: `${BASE_URL}/governance`, changefreq: "monthly", priority: "0.5", lastmod: today },
          { loc: `${BASE_URL}/changelog`, changefreq: "weekly", priority: "0.6", lastmod: today },
          { loc: `${BASE_URL}/legal`, changefreq: "yearly", priority: "0.3", lastmod: today },
          { loc: `${BASE_URL}/legal/privacy`, changefreq: "yearly", priority: "0.3", lastmod: today },
          { loc: `${BASE_URL}/legal/terms`, changefreq: "yearly", priority: "0.3", lastmod: today },
          { loc: `${BASE_URL}/legal/cookies`, changefreq: "yearly", priority: "0.3", lastmod: today },
          { loc: `${BASE_URL}/epublisher/pricing`, changefreq: "monthly", priority: "0.8", lastmod: today },
          { loc: `${BASE_URL}/creative-studio/pricing`, changefreq: "monthly", priority: "0.8", lastmod: today },
          { loc: `${BASE_URL}/sync-vision/pricing`, changefreq: "monthly", priority: "0.8", lastmod: today },
          { loc: `${BASE_URL}/youtube-optimizer/pricing`, changefreq: "monthly", priority: "0.8", lastmod: today },
        ];

        // Public detail page on the Hub for every app in APP_REGISTRY.
        const appDetailEntries: SitemapEntry[] = Object.values(APP_REGISTRY).map((e) => ({
          loc: `${BASE_URL}/apps/${e.key}`,
          changefreq: "weekly" as const,
          priority: e.status === "live" ? "0.8" : "0.6",
          lastmod: today,
        }));

        // One entry per canonical external app URL from APP_REGISTRY.
        const seen = new Set<string>();
        const appEntries: SitemapEntry[] = Object.values(APP_REGISTRY)
          .filter((e) => {
            if (seen.has(e.publicUrl)) return false;
            seen.add(e.publicUrl);
            // Skip the hub's own URL — already listed above.
            return !e.publicUrl.startsWith(BASE_URL);
          })
          .map((e) => ({
            loc: e.publicUrl,
            changefreq: "weekly" as const,
            priority: e.status === "live" ? "0.8" : "0.6",
            lastmod: today,
          }));

        const entries = [...hubEntries, ...appDetailEntries, ...appEntries];

        const urls = entries.map((e) =>
          [
            `  <url>`,
            `    <loc>${e.loc}</loc>`,
            e.lastmod ? `    <lastmod>${e.lastmod}</lastmod>` : null,
            e.changefreq ? `    <changefreq>${e.changefreq}</changefreq>` : null,
            e.priority ? `    <priority>${e.priority}</priority>` : null,
            `  </url>`,
          ]
            .filter(Boolean)
            .join("\n"),
        );

        const xml = [
          `<?xml version="1.0" encoding="UTF-8"?>`,
          `<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">`,
          ...urls,
          `</urlset>`,
        ].join("\n");

        return new Response(xml, {
          headers: {
            "Content-Type": "application/xml",
            "Cache-Control": "public, max-age=3600",
          },
        });
      },
    },
  },
});
