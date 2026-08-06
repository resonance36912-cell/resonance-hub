import { describe, it, expect } from "vitest";
import { APP_REGISTRY, type AppRegistryEntry } from "../../src/lib/app-registry";
import { APP_STATUS_MEANING, statusMeaning } from "../../src/lib/app-status-meaning";
import {
  appDetailMeta,
  appDetailTitle,
  appDetailUrl,
  appDetailSocialTitle,
  appDetailDescription,
  appDetailSocialDescription,
  type HeadMetaTag,
} from "../../src/lib/app-status-meta";

const entries = Object.values(APP_REGISTRY) as AppRegistryEntry[];

function get(tags: HeadMetaTag[], key: string): string | undefined {
  for (const t of tags) {
    if ("name" in t && t.name === key) return t.content;
    if ("property" in t && t.property === key) return t.content;
    if (key === "title" && "title" in t) return t.title;
  }
  return undefined;
}

describe("app detail OpenGraph/Twitter meta", () => {
  it("covers every registry app", () => {
    expect(entries.length).toBeGreaterThan(0);
  });

  for (const entry of entries) {
    const meaning = statusMeaning(entry.status);
    const tags = appDetailMeta(entry);

    describe(entry.key, () => {
      it("keeps the page title badge-free and stable", () => {
        expect(get(tags, "title")).toBe(appDetailTitle(entry));
        expect(get(tags, "title")).toBe(`${entry.label} — Resonance Apps`);
      });

      it("reflects the badge label and access line in og:title", () => {
        const og = get(tags, "og:title")!;
        expect(og).toBe(appDetailSocialTitle(entry));
        expect(og).toContain(entry.label);
        expect(og).toContain(meaning.label);
        expect(og).toContain(meaning.access);
      });

      it("mirrors og:* into twitter:*", () => {
        expect(get(tags, "twitter:title")).toBe(get(tags, "og:title"));
        expect(get(tags, "twitter:description")).toBe(get(tags, "og:description"));
        expect(get(tags, "twitter:card")).toBe("summary_large_image");
      });

      it("states availability in both descriptions", () => {
        expect(get(tags, "description")).toBe(appDetailDescription(entry));
        expect(get(tags, "description")).toContain(meaning.access);
        expect(get(tags, "og:description")).toBe(appDetailSocialDescription(entry));
        expect(get(tags, "og:description")).toContain(meaning.explanation);
      });

      it("does not leak a contradicting status wording", () => {
        const blob = tags
          .map((t) => ("title" in t ? t.title : t.content))
          .join(" | ");
        for (const [status, other] of Object.entries(APP_STATUS_MEANING)) {
          if (status === entry.status) continue;
          expect(blob).not.toContain(other.access);
          expect(blob).not.toContain(other.explanation);
        }
      });

      it("self-references its canonical URL", () => {
        expect(get(tags, "og:url")).toBe(appDetailUrl(entry.key));
        expect(get(tags, "og:url")).toBe(`https://reson8.life/apps/${entry.key}`);
      });

      it("exposes machine-readable status", () => {
        expect(get(tags, "resonance:status")).toBe(entry.status);
        expect(get(tags, "resonance:access")).toBe(meaning.access);
      });
    });
  }
});
