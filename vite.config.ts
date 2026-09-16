import { resolve } from "node:path";
import { defineConfig, type Plugin } from "vite";
import { tanstackStart } from "@tanstack/react-start/plugin/vite";
import { nitro } from "nitro/vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import tsconfigPaths from "vite-tsconfig-paths";

const normalizeWindowsRoot: Plugin = {
  name: "ronsas-normalize-windows-root",
  enforce: "pre",
  configResolved(config) {
    if (process.platform !== "win32") return;
    const mutableConfig = config as { root: string };
    mutableConfig.root = resolve(mutableConfig.root);
  },
};

export default defineConfig({
  define: {
    "import.meta.env.VITE_RONS_AUTH_MODE": JSON.stringify("sovereign"),
    "import.meta.env.VITE_RONS_AUTH_SHADOW": JSON.stringify("0"),
  },
  css: { transformer: "lightningcss" },
  resolve: {
    alias: { "@": `${process.cwd()}/src` },
    dedupe: ["react", "react-dom", "@tanstack/react-query", "@tanstack/query-core"],
  },
  build: {
    rollupOptions: {
      output: {
        manualChunks(id) {
          if (id.includes("/node_modules/@supabase/") || id.includes("\\node_modules\\@supabase\\")) {
            return "vendor-supabase";
          }
        },
      },
    },
  },
  plugins: [
    normalizeWindowsRoot,
    tailwindcss(),
    tsconfigPaths({ projects: ["./tsconfig.json"] }),
    tanstackStart({
      server: { entry: "server" },
      importProtection: {
        behavior: "error",
        client: { files: ["**/server/**"], specifiers: ["server-only"] },
      },
    }),
    nitro({ preset: "node-server" }),
    react(),
  ],
});
