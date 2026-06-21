/**
 * Generate openapi.json from Fastify route registrations.
 *
 *   npm run openapi:generate
 *
 * Scans backend/src/routes/*.ts for app.get/post/patch/put/delete("…")
 * and writes backend/openapi.json. Re-run after adding routes.
 */

import { readFileSync, readdirSync, writeFileSync } from "fs";
import { join, dirname } from "path";
import { fileURLToPath } from "url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const routesDir = join(__dirname, "../src/routes");
const outFile = join(__dirname, "../openapi.json");

const ROUTE_RE =
  /app\.(get|post|put|patch|delete)\(\s*["'`]([^"'`]+)["'`]/g;

/** Paths served without Bearer auth (prefix match on /v1 path). */
const PUBLIC_PREFIXES = [
  "/auth/login",
  "/auth/pin",
  "/auth/pin/users",
  "/public/",
  "/storefront-mock/",
];

const TAG_MAP: Record<string, string> = {
  auth: "Auth",
  roles: "Auth",
  users: "Auth",
  products: "Catalog",
  categories: "Catalog",
  customers: "Catalog",
  vendors: "Procurement",
  warehouses: "Inventory",
  ledger: "Inventory",
  inventory: "Inventory",
  valuation: "Inventory",
  "pick-lists": "Fulfilment",
  "packing-slips": "Fulfilment",
  couriers: "Fulfilment",
  "transfer-orders": "Transfers",
  "putaway-rules": "Transfers",
  "purchase-orders": "Procurement",
  grns: "Procurement",
  quotes: "Sales",
  "sales-orders": "Sales",
  "dispatch-options": "Sales",
  invoices: "Billing",
  dispatches: "Billing",
  "production-facilities": "Manufacturing",
  "work-centers": "Manufacturing",
  "production-lines": "Manufacturing",
  machines: "Manufacturing",
  boms: "Manufacturing",
  "production-orders": "Manufacturing",
  workers: "Workforce",
  reports: "Reports",
  settings: "Settings",
  enquiries: "Enquiries",
  returns: "Returns",
  "stock-rules": "Stock rules",
  sync: "Sync",
  locations: "Locations",
  trips: "Trips",
  "price-lists": "Pricing",
  pricing: "Pricing",
  uoms: "UoM",
  approvals: "Approvals",
  "customer-payments": "Billing",
};

function tagForPath(path: string): string {
  const seg = path.replace(/^\//, "").split("/")[0];
  return TAG_MAP[seg] ?? "Other";
}

function isPublic(path: string): boolean {
  return PUBLIC_PREFIXES.some((p) => path.startsWith(p));
}

type Op = { method: string; path: string; tag: string; public: boolean };

const ops: Op[] = [];

for (const file of readdirSync(routesDir).filter((f) => f.endsWith(".ts"))) {
  const src = readFileSync(join(routesDir, file), "utf8");
  let m: RegExpExecArray | null;
  while ((m = ROUTE_RE.exec(src))) {
    const method = m[1].toLowerCase();
    let path = m[2];
    if (!path.startsWith("/")) path = `/${path}`;
    ops.push({ method, path, tag: tagForPath(path), public: isPublic(path) });
  }
}

const seen = new Set<string>();
const unique = ops.filter((o) => {
  const k = `${o.method} ${o.path}`;
  if (seen.has(k)) return false;
  seen.add(k);
  return true;
});

unique.sort((a, b) => a.path.localeCompare(b.path) || a.method.localeCompare(b.method));

const tags = [...new Set(unique.map((o) => o.tag))].sort();

const paths: Record<string, Record<string, unknown>> = {};

for (const op of unique) {
  const fullPath = op.path.replace(/:([a-zA-Z]+)/g, "{$1}");
  if (!paths[fullPath]) paths[fullPath] = {};

  const operation: Record<string, unknown> = {
    tags: [op.tag],
    summary: `${op.method.toUpperCase()} ${op.path}`,
    responses: {
      "200": { description: "Success" },
      "400": {
        description: "Validation error",
        content: { "application/json": { schema: { $ref: "#/components/schemas/Error" } } },
      },
      "401": {
        description: "Unauthorized",
        content: { "application/json": { schema: { $ref: "#/components/schemas/Error" } } },
      },
      "404": {
        description: "Not found",
        content: { "application/json": { schema: { $ref: "#/components/schemas/Error" } } },
      },
    },
  };

  if (!op.public) operation.security = [{ bearerAuth: [] }];

  if (["post", "put", "patch"].includes(op.method)) {
    operation.requestBody = {
      content: {
        "application/json": { schema: { type: "object", additionalProperties: true } },
      },
    };
  }

  paths[fullPath][op.method] = operation;
}

const spec: Record<string, unknown> = {
  openapi: "3.1.0",
  info: {
    title: "NovaERP API",
    version: "1.0.0",
    description:
      "REST API for NovaERP. All business endpoints are under /v1. " +
      "Authenticate with POST /v1/auth/login or POST /v1/auth/pin, then send Authorization: Bearer <token>. " +
      "Interactive docs: /docs · Raw spec: /docs/json · Regenerate: npm run openapi:generate",
    contact: { name: "NovaERP" },
  },
  servers: [
    { url: "http://localhost:4000/v1", description: "Local dev (direct backend)" },
    { url: "http://217.216.78.119/v1", description: "Production VPS (via nginx)" },
  ],
  tags: tags.map((name) => ({ name })),
  paths,
  components: {
    securitySchemes: {
      bearerAuth: {
        type: "http",
        scheme: "bearer",
        bearerFormat: "JWT",
        description: "Obtain from POST /v1/auth/login or POST /v1/auth/pin",
      },
    },
    schemas: {
      Error: {
        type: "object",
        properties: {
          error: {
            type: "object",
            properties: {
              code: { type: "string" },
              message: { type: "string" },
              details: {},
            },
          },
        },
      },
      AuthResponse: {
        type: "object",
        required: ["token", "user"],
        properties: {
          token: { type: "string", description: "JWT valid 8–12h" },
          user: { $ref: "#/components/schemas/User" },
        },
      },
      User: {
        type: "object",
        properties: {
          id: { type: "string" },
          username: { type: "string" },
          name: { type: "string" },
          role: {
            type: "string",
            enum: ["admin", "supervisor", "warehouse", "procurement", "billing", "worker"],
          },
        },
      },
      LoginRequest: {
        type: "object",
        required: ["username", "password"],
        properties: {
          username: { type: "string", minLength: 2 },
          password: { type: "string", minLength: 1 },
        },
      },
      PinRequest: {
        type: "object",
        required: ["username", "pin"],
        properties: {
          username: { type: "string", minLength: 2 },
          pin: { type: "string", minLength: 6, maxLength: 6 },
        },
      },
      Warehouse: {
        type: "object",
        properties: {
          id: { type: "string" },
          code: { type: "string", example: "STR" },
          name: { type: "string", example: "Stock Room" },
          scanPrefix: { type: "string", example: "STR" },
          kind: { type: "string", enum: ["storage", "production", "other"] },
          city: { type: "string" },
        },
      },
      Bin: {
        type: "object",
        properties: {
          id: { type: "string" },
          warehouseId: { type: "string" },
          zone: { type: "string", example: "C" },
          shelf: { type: "string", example: "S05" },
          bin: { type: "string", example: "08" },
          code: { type: "string", example: "STR.CS05.08" },
          qty: { type: "number" },
          reservedQty: { type: "number" },
        },
      },
      ScanResult: {
        type: "object",
        description: "Unified scan resolver (bin, product, container, …)",
        additionalProperties: true,
      },
    },
  },
};

function enrich(path: string, method: string, patch: Record<string, unknown>) {
  const p = paths[path]?.[method];
  if (p && typeof p === "object") Object.assign(p, patch);
}

enrich("/auth/login", "post", {
  summary: "Password login",
  security: [],
  requestBody: {
    required: true,
    content: { "application/json": { schema: { $ref: "#/components/schemas/LoginRequest" } } },
  },
  responses: {
    "200": {
      description: "JWT + user profile",
      content: { "application/json": { schema: { $ref: "#/components/schemas/AuthResponse" } } },
    },
    "401": { description: "Invalid credentials" },
  },
});

enrich("/auth/pin", "post", {
  summary: "PIN login (warehouse floor)",
  security: [],
  requestBody: {
    required: true,
    content: { "application/json": { schema: { $ref: "#/components/schemas/PinRequest" } } },
  },
  responses: {
    "200": {
      description: "JWT + user profile",
      content: { "application/json": { schema: { $ref: "#/components/schemas/AuthResponse" } } },
    },
  },
});

enrich("/auth/pin/users", "get", {
  summary: "Users eligible for PIN login",
  security: [],
  responses: {
    "200": {
      description: "username + name list",
      content: {
        "application/json": {
          schema: {
            type: "array",
            items: {
              type: "object",
              properties: {
                username: { type: "string" },
                name: { type: "string" },
                role: { type: "string" },
              },
            },
          },
        },
      },
    },
  },
});

enrich("/auth/me", "get", {
  summary: "Current user from JWT",
  responses: {
    "200": { content: { "application/json": { schema: { $ref: "#/components/schemas/User" } } } },
  },
});

enrich("/warehouses", "get", {
  summary: "List warehouses",
  responses: {
    "200": {
      content: {
        "application/json": { schema: { type: "array", items: { $ref: "#/components/schemas/Warehouse" } } },
      },
    },
  },
});

enrich("/warehouses/{id}/bins", "get", {
  summary: "Bins in a warehouse",
  parameters: [
    { name: "id", in: "path", required: true, schema: { type: "string" } },
    { name: "limit", in: "query", schema: { type: "integer", default: 500 } },
    { name: "q", in: "query", schema: { type: "string" }, description: "Search bin code / zone / shelf" },
  ],
  responses: {
    "200": {
      content: {
        "application/json": { schema: { type: "array", items: { $ref: "#/components/schemas/Bin" } } },
      },
    },
  },
});

enrich("/locations/scan", "get", {
  summary: "Resolve scanned barcode (bin, SKU, container, …)",
  parameters: [
    { name: "code", in: "query", required: true, schema: { type: "string", example: "STR.CS05.08" } },
  ],
  responses: {
    "200": { content: { "application/json": { schema: { $ref: "#/components/schemas/ScanResult" } } } },
  },
});

writeFileSync(outFile, JSON.stringify(spec, null, 2) + "\n", "utf8");
console.log(`Wrote ${outFile} (${unique.length} operations, ${Object.keys(paths).length} paths)`);
