import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { VitePWA } from "vite-plugin-pwa";
import path from "node:path";
import { readFileSync } from "node:fs";

// Prakruthivanam storefront. Runs on a separate port (5174) so it can be
// developed alongside the ERP portal (5173) without collisions. The
// dev server proxies /v1/* to the NovaERP backend on :4000 so api.ts
// can use relative paths in both dev and production.
// Pre-read the pincode JSON so the browser shim can inline it without
// relying on Node's fs at runtime. We expose it as a virtual module.
const PINCODE_VIRTUAL = "virtual:pincodes-json";
const PINCODE_JSON_PATH = path.resolve(
  __dirname,
  "node_modules/@twin.techies/india-pincode/data/pincodes.json"
);

export default defineConfig({
  plugins: [
    // Virtual module that inlines the pincode JSON for the browser shim.
    {
      name: "inline-pincodes",
      resolveId(id) {
        if (id === PINCODE_VIRTUAL) return "\0" + PINCODE_VIRTUAL;
      },
      load(id) {
        if (id === "\0" + PINCODE_VIRTUAL) {
          const raw = readFileSync(PINCODE_JSON_PATH, "utf8");
          return `export default ${raw};`;
        }
      },
    },
    react(),
    VitePWA({
      registerType: "prompt",
      // Inline the SW registration so we can show our own update toast.
      injectRegister: null,
      // Service worker is built alongside the app bundle.
      strategies: "generateSW",
      includeAssets: [
        "brand/logo.png",
        "brand/farm-portrait.jpg",
        "robots.txt",
      ],
      manifest: {
        name: "Prakruthivanam",
        short_name: "Prakruthivanam",
        description:
          "Shop 100% chemical-free organic millets, cold-pressed oils, natural sweeteners and handmade personal care from Prakruthivanam.",
        theme_color: "#385f1c",
        background_color: "#fdfaf2",
        display: "standalone",
        orientation: "portrait-primary",
        scope: "/",
        start_url: "/?source=pwa",
        categories: ["shopping", "food"],
        icons: [
          {
            src: "/brand/icons/pwa-192x192.png",
            sizes: "192x192",
            type: "image/png",
            purpose: "any",
          },
          {
            src: "/brand/icons/pwa-512x512.png",
            sizes: "512x512",
            type: "image/png",
            purpose: "any",
          },
          {
            src: "/brand/icons/pwa-maskable-512x512.png",
            sizes: "512x512",
            type: "image/png",
            purpose: "maskable",
          },
        ],
        screenshots: [
          {
            src: "/brand/screenshots/mobile-home.png",
            sizes: "390x844",
            type: "image/png",
            form_factor: "narrow",
          },
        ],
      },
      workbox: {
        // The pincode JSON bundle is large but only cached once; raise the
        // precache size limit above the default 2 MiB accordingly.
        maximumFileSizeToCacheInBytes: 4 * 1024 * 1024,
        // Navigate-fallback so deep-links work offline.
        navigateFallback: "/index.html",
        navigateFallbackDenylist: [/^\/v1\//, /^\/uploads\//, /^\/\.well-known\//],
        runtimeCaching: [
          // Category + product images: stale-while-revalidate.
          // Cache-key includes ?v= query which we append from updatedAt.
          {
            urlPattern: ({ url }) => url.pathname.startsWith("/uploads/"),
            handler: "StaleWhileRevalidate",
            options: {
              cacheName: "uploads-images",
              expiration: { maxEntries: 300, maxAgeSeconds: 60 * 60 * 24 * 30 },
              cacheableResponse: { statuses: [0, 200] },
            },
          },
          // API data: network-first with 4 s timeout → cache fallback.
          {
            urlPattern: ({ url }) =>
              url.pathname.startsWith("/v1/") &&
              !url.pathname.includes("/auth/") &&
              !url.pathname.includes("/otp"),
            handler: "NetworkFirst",
            options: {
              cacheName: "api-data",
              networkTimeoutSeconds: 4,
              expiration: { maxEntries: 50, maxAgeSeconds: 60 * 60 * 24 },
              cacheableResponse: { statuses: [0, 200] },
            },
          },
          // Google Fonts: cache-first forever.
          {
            urlPattern: ({ url }) =>
              url.origin === "https://fonts.googleapis.com" ||
              url.origin === "https://fonts.gstatic.com",
            handler: "CacheFirst",
            options: {
              cacheName: "google-fonts",
              expiration: { maxEntries: 10, maxAgeSeconds: 60 * 60 * 24 * 365 },
              cacheableResponse: { statuses: [0, 200] },
            },
          },
        ],
      },
      devOptions: {
        // Enable SW in dev for Capacitor WebView testing.
        enabled: false,
        type: "module",
      },
    }),
  ],
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
      "/uploads": {
        target: "http://localhost:4000",
        changeOrigin: true,
      },
    },
  },
});
