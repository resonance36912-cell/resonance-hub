import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";

const read = (path: string) => readFileSync(path, "utf8");
const posterPath = "src/routes/api/public/generate/creative-studio/poster.ts";
const ropPath = "src/routes/api/public/rop/cron/cross-app-scan.ts";

describe("RONSAS production sovereign AI boundary", () => {
  test("routes Creative Studio posters through the local image service", () => {
    const text = read(posterPath);
    expect(text).toContain('const LOCAL_IMAGE_SERVICE = "http://127.0.0.1:7865/v1/images/generate"');
    expect(text).toContain("aspectRatio: parsed.aspectRatio");
    expect(text).not.toContain("LOVABLE_API_KEY");
    expect(text).not.toContain("ai.gateway.lovable.dev");
  });

  test("keeps the poster entitlement gate before generation", () => {
    const text = read(posterPath);
    expect(text.indexOf("gate = await requireTierFromRequest")).toBeGreaterThan(-1);
    expect(text.indexOf("fetch(LOCAL_IMAGE_SERVICE")).toBeGreaterThan(text.indexOf("gate = await requireTierFromRequest"));
  });

  test("routes ROP cross-app analysis through the governed local broker", () => {
    const text = read(ropPath);
    expect(text).toContain('fetch("http://127.0.0.1:7868/v1/chat"');
    expect(text).toContain('provider: "rons-local"');
    expect(text).toContain("human_approved_external: false");
    expect(text).not.toContain("LOVABLE_API_KEY");
    expect(text).not.toContain("ai.gateway.lovable.dev");
  });
});
