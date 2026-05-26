import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import path from "node:path";

// Prakruthivanam storefront. Runs on a separate port (5174) so it can be
// developed alongside the ERP portal (5173) without collisions. The
// dev server proxies /v1/* to the NovaERP backend on :4000 so api.ts
// can use relative paths in both dev and production.
export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: { "@": path.resolve(__dirname, "src") },
  },
  server: {
    port: 5174,
    host: true,
    proxy: {
      "/v1": {
        target: "http://localhost:4000",
        changeOrigin: true,
      },
    },
  },
});
