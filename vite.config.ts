import { defineConfig } from "vite";
import { tanstackStart } from "@tanstack/react-start/plugin/vite";
import { nitro } from "nitro/vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import tsconfigPaths from "vite-tsconfig-paths";

const railwayPreviewAllowedHosts = [\n  "healthcheck.railway.app",\n  process.env.RAILWAY_PUBLIC_DOMAIN,\n  process.env.RAILWAY_PRIVATE_DOMAIN,\n].filter((host): host is string => Boolean(host));\n\nexport default defineConfig({
  css: { transformer: "lightningcss" },
  resolve: {
    alias: { "@": `${process.cwd()}/src` },
    dedupe: [
      "react",
      "react-dom",
      "react/jsx-runtime",
      "react/jsx-dev-runtime",
      "@tanstack/react-query",
      "@tanstack/query-core",
    ],
  },
  optimizeDeps: {
    include: ["react", "react-dom", "react-dom/client", "react/jsx-runtime", "react/jsx-dev-runtime"],
    ignoreOutdatedRequests: true,
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
    tailwindcss(),
    tsconfigPaths({ projects: ["./tsconfig.json"] }),
    tanstackStart({
      server: { entry: "server" },
      importProtection: {
        behavior: "error",
        client: { files: ["**/server/**"], specifiers: ["server-only"] },
      },
    }),
    nitro({
      preset: "cloudflare-module",
    }),
    react(),
  ],
  server: { host: "::", port: 8080, allowedHosts: [".railway.app", ".railway.internal"] },
  preview: { allowedHosts: railwayPreviewAllowedHosts },
});
