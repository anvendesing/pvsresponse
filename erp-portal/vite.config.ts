import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import path from "path";

// Mode-aware config. `--mode mobile` (warehouse APK) builds a slim
// bundle without the desktop ERP pages and recharts; everything else
// is the regular web build with both desktop and the /m/* PWA routes.
export default defineConfig(({ mode }) => ({
  plugins: [react()],
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
    },
  },
  server: {
    port: 5173,
  },
  define: {
    // Hard-code the mode string so it's a literal Rollup can use for
    // dead-code elimination in main.tsx's MOBILE_BUILD branch.
    "import.meta.env.MODE": JSON.stringify(mode),
  },
  build: {
    // Slim chunk strategy for the mobile build: react vendor in its
    // own chunk, everything else in index. Keeps initial parse small.
    rollupOptions:
      mode === "mobile"
        ? {
            output: {
              manualChunks: {
                "vendor-react": [
                  "react",
                  "react-dom",
                  "react-router-dom",
                ],
              },
            },
          }
        : undefined,
  },
}));
