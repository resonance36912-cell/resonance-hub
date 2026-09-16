import { describe, expect, it } from "bun:test";
import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";

const source = (path: string) => readFileSync(resolve(process.cwd(), path), "utf8");

const CHAT = "src/routes/api/chat.ts";
const POSTER = "src/routes/api/public/generate/creative-studio/poster.ts";
const CROSS_APP = "src/routes/api/public/rop/cron/cross-app-scan.ts";

describe("RONSAS sovereign AI routes", () => {
  it("routes Hub chat only through the loopback RONS AI broker", () => {
    const text = source(CHAT);
    expect(text).toContain('const RONS_AI_BROKER = "http://127.0.0.1:7868"');
    expect(text).toContain('provider: RONS_CHAT_PROVIDER');
    expect(text).toContain('createUIMessageStream');
    expect(text).not.toContain("LOVABLE_API_KEY");
    expect(text).not.toContain("ai.gateway.lovable.dev");
    expect(text).not.toContain("createLovableAiGatewayProvider");
  });

  it("routes Creative Studio posters through the loopback image service", () => {
    const text = source(POSTER);
    expect(text).toContain(
      'const LOCAL_IMAGE_SERVICE = "http://127.0.0.1:7865/v1/images/generate"',
    );
    expect(text).toContain("aspectRatio: parsed.aspectRatio");
    expect(text).not.toContain("LOVABLE_API_KEY");
    expect(text).not.toContain("ai.gateway.lovable.dev");
  });

  it("keeps the poster entitlement gate ahead of local generation", () => {
    const text = source(POSTER);
    const gate = text.indexOf("gate = await requireTierFromRequest");
    const generation = text.indexOf("fetch(LOCAL_IMAGE_SERVICE");
    expect(gate).toBeGreaterThan(-1);
    expect(generation).toBeGreaterThan(gate);
  });


  it("routes ROP cross-app analysis through the local broker", () => {
    const text = source(CROSS_APP);
    expect(text).toContain('fetch("http://127.0.0.1:7868/v1/chat"');
    expect(text).toContain('provider: "rons-local"');
    expect(text).toContain("human_approved_external: false");
    expect(text).not.toContain("LOVABLE_API_KEY");
    expect(text).not.toContain("ai.gateway.lovable.dev");
  });
  it("removes the obsolete Lovable AI gateway module", () => {
    expect(existsSync(resolve(process.cwd(), "src/lib/ai-gateway.server.ts"))).toBe(false);
  });
});