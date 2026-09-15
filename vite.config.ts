// @lovable.dev/vite-tanstack-config already includes the following — do NOT add them manually
// or the app will break with duplicate plugins:
//   - tanstackStart, viteReact, tailwindcss, tsConfigPaths, cloudflare (build-only),
//     componentTagger (dev-only), VITE_* env injection, @ path alias, React/TanStack dedupe,
//     error logger plugins, and sandbox detection (port/host/strictPort).
// You can pass additional config via defineConfig({ vite: { ... } }) if needed.
import { resolve } from "node:path";

import { mcpPlugin } from "@lovable.dev/mcp-js/stacks/tanstack/vite";
import { defineConfig } from "@lovable.dev/vite-tanstack-config";
import type { Plugin } from "vite";

const normalizeWindowsRoot: Plugin = {
  name: "ronsas-normalize-windows-root",
  enforce: "pre",
  configResolved(config) {
    if (process.platform !== "win32") return;
    const mutableConfig = config as { root: string };
    mutableConfig.root = resolve(mutableConfig.root);
  },
};

// Redirect TanStack Start's bundled server entry to src/server.ts (our SSR error wrapper).
// @cloudflare/vite-plugin builds from this — wrangler.jsonc main alone is insufficient.
export default defineConfig({
  tanstackStart: { server: { entry: "server" } },
  vite: { plugins: [normalizeWindowsRoot, mcpPlugin()] },
});
