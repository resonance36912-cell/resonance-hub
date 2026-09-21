import { defineConfig } from "vite";
import { tanstackStart } from "@tanstack/react-start/plugin/vite";
import { nitro } from "nitro/vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import tsconfigPaths from "vite-tsconfig-paths";

// Dedicated cloud build. Do not import the local config: it enables auth shadow
// comparisons/token exchange and allows the local output directory to change.
export default defineConfig({
  define: {
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
          if (
            id.includes("/node_modules/@supabase/") ||
            id.includes("\\node_modules\\@supabase\\")
          ) {
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
    // Preserve the preset spelling already used by the pinned Nitro beta.
    nitro({ preset: "node-server", output: { dir: ".output-railway" } }),
    react(),
  ],
});
