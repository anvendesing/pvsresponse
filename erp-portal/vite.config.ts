import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import path from "path";
import { readFileSync } from "fs";

const PINCODE_VIRTUAL = "virtual:pincodes-json";
const PINCODE_JSON_PATH = path.resolve(
  __dirname,
  "node_modules/@twin.techies/india-pincode/data/pincodes.json"
);

// Mode-aware config. `--mode mobile` (warehouse APK) builds a slim
// bundle without the desktop ERP pages and recharts; everything else
// is the regular web build with both desktop and the /m/* PWA routes.
export default defineConfig(({ mode }) => ({
  plugins: [
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
  ],
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
