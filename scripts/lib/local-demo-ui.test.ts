import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";

const root = readFileSync("src/routes/__root.tsx", "utf8");
const registry = readFileSync("src/lib/app-registry.ts", "utf8");
const index = readFileSync("src/routes/index.tsx", "utf8");

describe("RONS local demo UI", () => {
  test("launcher is private-LAN only and derives the current host", () => {
    expect(root).toContain("RONS Local Demo");
    expect(root).toContain("isPrivateDemoHost");
    expect(root).toContain('host.startsWith("192.168.")');
    expect(root).toContain("`http://${host}:${port}`");
    expect(root).not.toContain("192.168.1.50");
  });

  test("local demo exposes the four locally hosted spoke ports", () => {
    expect(root).toContain('["ePublisher", 3101]');
    expect(root).toContain('["Creative Studio", 3201]');
    expect(root).toContain('["Sync Vision", 3301]');
    expect(root).toContain('["YouTube Optimizer", 3401]');
  });
  test("canonical public URLs remain authoritative in registry and metadata", () => {
    expect(registry).toContain('const HUB_URL = "https://reson8.life"');
    expect(registry).toContain('url: "https://www.resonanceonline.life"');
    expect(registry).toContain('url: "https://www.creativestudio.life"');
    expect(registry).toContain('url: "https://www.syncvision.life"');
    expect(index).toContain('href: "https://www.resonanceonline.life"');
    expect(index).toContain('href: "https://www.creativestudio.life"');
    expect(index).toContain('href: "https://www.syncvision.life"');
    expect(registry).not.toContain("http://192.168.1.50");
    expect(index).not.toContain("http://192.168.1.50");
  });
});
