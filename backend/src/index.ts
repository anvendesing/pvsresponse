import { config as loadEnv } from "dotenv";
import Fastify, { type FastifyInstance } from "fastify";

loadEnv();
import cors from "@fastify/cors";
import sensible from "@fastify/sensible";
import { ZodError } from "zod";
import { config } from "./config.js";
import { registerAuth } from "./auth/plugin.js";
import { authRoutes } from "./routes/auth.js";
import { catalogRoutes } from "./routes/catalog.js";
import { categoriesRoutes } from "./routes/categories.js";
import { inventoryRoutes } from "./routes/inventory.js";
import { mfgRoutes } from "./routes/manufacturing.js";
import { procurementRoutes } from "./routes/procurement.js";
import { workforceRoutes } from "./routes/workforce.js";
import { billingRoutes } from "./routes/billing.js";
import { reportsRoutes } from "./routes/reports.js";
import { approvalsRoutes } from "./routes/approvals.js";
import { salesRoutes } from "./routes/sales.js";
import { fulfilmentRoutes } from "./routes/fulfilment.js";
import { pricingRoutes } from "./routes/pricing.js";
import { settingsRoutes } from "./routes/settings.js";
import { shareRoutes } from "./routes/share.js";
import { tripRoutes } from "./routes/trips.js";
import { syncRoutes } from "./routes/sync.js";
import { uomRoutes } from "./routes/uoms.js";
import { locationsRoutes } from "./routes/locations.js";
import { storefrontMockRoutes } from "./routes/storefront-mock.js";
import { bulkOrderRoutes } from "./routes/bulk-order.js";
import { customerPaymentRoutes } from "./routes/customer-payments.js";
import { returnsRoutes } from "./routes/returns.js";
import { transfersRoutes } from "./routes/transfers.js";
import { enquiriesRoutes } from "./routes/enquiries.js";
import { stockRulesRoutes } from "./routes/stock-rules.js";
import multipart from "@fastify/multipart";
import fastifyStatic from "@fastify/static";
import { fileURLToPath } from "url";
import { dirname, join } from "path";
import { mkdirSync } from "fs";

const app = Fastify({ logger: { level: "info" } });

await app.register(cors, {
  origin: config.corsOrigin === "*" ? true : config.corsOrigin.split(","),
  credentials: true,
});
await app.register(sensible);
await app.register(multipart, { limits: { fileSize: 50 * 1024 * 1024 } }); // 50 MB max upload

// Serve user-uploaded media (currently: product photos under
// /uploads/products/*.jpg referenced by Product.imageUrl). The folder
// is created if missing so a fresh clone has no setup step.
const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const uploadsRoot = join(__dirname, "..", "uploads");
mkdirSync(join(uploadsRoot, "products"), { recursive: true });
mkdirSync(join(uploadsRoot, "categories"), { recursive: true });
await app.register(fastifyStatic, {
  root: uploadsRoot,
  prefix: "/uploads/",
  decorateReply: false,
});
await registerAuth(app);

app.setErrorHandler((err, _req, reply) => {
  if (err instanceof ZodError) {
    return reply.code(400).send({ error: { code: "validation", message: "Validation failed", details: err.issues } });
  }
  app.log.error(err);
  const e = err as { statusCode?: number; message?: string };
  return reply.code(e.statusCode ?? 500).send({
    error: { code: "internal", message: e.message ?? "Internal error" },
  });
});

app.get("/health", async () => ({ status: "ok", time: new Date().toISOString() }));

// Friendly index so visiting the root in a browser doesn't 404.
// Returns JSON by default; for browsers (Accept: text/html) we return
// a small directory page that links to /v1, /health and Prisma Studio.
app.get("/", async (req, reply) => {
  const accept = (req.headers["accept"] ?? "").toString();
  const meta = {
    name: "NovaERP API",
    version: "1.0.0",
    api: "/v1",
    health: "/health",
    docs: {
      auth: "/v1/auth/login (POST)",
      catalog: "/v1/products, /v1/customers, /v1/suppliers",
      sales: "/v1/quotes, /v1/sales-orders, /v1/invoices",
      fulfilment: "/v1/pick-lists, /v1/packing-slips",
      inventory: "/v1/warehouses, /v1/stock-ledger",
      manufacturing: "/v1/boms, /v1/work-orders, /v1/stations",
      reports: "/v1/reports/*",
    },
  };
  if (accept.includes("text/html")) {
    reply.header("Content-Type", "text/html; charset=utf-8");
    return `<!doctype html><html><head><meta charset="utf-8"><title>NovaERP API</title>
<style>
  body{font:14px/1.5 -apple-system,Segoe UI,Roboto,sans-serif;max-width:780px;margin:48px auto;padding:0 24px;color:#0d1b2a}
  h1{font-size:20px;margin:0 0 4px;color:#0a4d8c}
  .sub{color:#6b7280;margin-bottom:24px;font-size:13px}
  .card{border:1px solid #e5e7eb;border-radius:8px;padding:16px 20px;margin-bottom:12px;background:#fff}
  .row{display:flex;justify-content:space-between;align-items:center;padding:6px 0;border-bottom:1px dashed #e5e7eb}
  .row:last-child{border:0}
  code{background:#f3f4f6;padding:2px 6px;border-radius:4px;color:#0a4d8c;font-size:12px}
  a{color:#0a4d8c;text-decoration:none}
  a:hover{text-decoration:underline}
  .pill{background:#10b981;color:#fff;padding:2px 8px;border-radius:10px;font-size:11px;font-weight:600}
</style></head><body>
  <h1>NovaERP API <span class="pill">running</span></h1>
  <div class="sub">All endpoints are mounted under <code>/v1</code>. Open the React portal at <a href="http://localhost:5173">http://localhost:5173</a>.</div>
  <div class="card">
    <div class="row"><span><strong>Health probe</strong></span><a href="/health">/health</a></div>
    <div class="row"><span><strong>API base</strong></span><a href="/v1/products">/v1</a></div>
    <div class="row"><span><strong>Auth</strong></span><code>POST /v1/auth/login</code></div>
  </div>
  <div class="card">
    <strong>Common reads (require Bearer token)</strong>
    <div class="row"><span>Catalog</span><code>/v1/products · /v1/customers · /v1/suppliers</code></div>
    <div class="row"><span>Sales</span><code>/v1/quotes · /v1/sales-orders · /v1/invoices</code></div>
    <div class="row"><span>Fulfilment</span><code>/v1/pick-lists · /v1/packing-slips</code></div>
    <div class="row"><span>Inventory</span><code>/v1/warehouses · /v1/stock-ledger</code></div>
    <div class="row"><span>Manufacturing</span><code>/v1/boms · /v1/work-orders · /v1/stations</code></div>
    <div class="row"><span>Reports</span><code>/v1/reports/*</code></div>
  </div>
</body></html>`;
  }
  return meta;
});

// Helper: wrap a route plugin in a scoped Fastify context that enforces a
// role allowlist. admin always passes (enforced inside requireRole).
// Using scoped plugins keeps the route definitions unchanged while adding
// the hook at the mount boundary.
//
// Routes whose path starts with /public/ are exempted — they're served
// over share-token auth (the token in the URL itself) and were getting
// blanket-blocked by the role gate, which is what produced the
// "Quote unavailable · Login required" error on share/quote and
// share/company links.
const withRole = (
  api: FastifyInstance,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  plugin: (instance: FastifyInstance, opts: Record<string, unknown>, done: () => void) => Promise<void> | void,
  ...roles: string[]
) =>
  api.register(async (scoped) => {
    const roleGate = scoped.requireRole(...roles);
    scoped.addHook("preHandler", async (req, reply) => {
      // req.url includes the prefix (e.g. "/v1/public/quotes/abc?print=1").
      // Match anywhere; the prefix is configurable upstream.
      if (req.url.includes("/public/")) return;
      await roleGate(req, reply);
    });
    await scoped.register(plugin);
  });

// API v1
await app.register(
  async (api) => {
    // Auth + public routes — no role gate (they do their own auth checks)
    await api.register(authRoutes);
    await api.register(shareRoutes);         // public share links (/public/*)
    await api.register(storefrontMockRoutes); // ecommerce storefront (public)
    await api.register(syncRoutes);           // any authenticated user

    // Catalog — read-only by everyone; write protected per-route inside catalog.ts
    await api.register(catalogRoutes);
    await api.register(categoriesRoutes);

    // Sales & order management
    await withRole(api, enquiriesRoutes,     "supervisor", "billing");
    await withRole(api, salesRoutes,         "supervisor", "billing");
    await withRole(api, bulkOrderRoutes,     "supervisor", "billing");
    await withRole(api, billingRoutes,       "billing");
    await withRole(api, customerPaymentRoutes, "billing");
    await withRole(api, returnsRoutes,       "supervisor", "billing", "warehouse");
    await withRole(api, approvalsRoutes,     "supervisor", "billing");

    // Fulfilment — warehouse staff + billing (for invoice generation)
    await withRole(api, fulfilmentRoutes,    "supervisor", "warehouse", "billing");
    await withRole(api, tripRoutes,          "supervisor", "warehouse");
    await withRole(api, locationsRoutes,     "supervisor", "warehouse");

    // Procurement
    await withRole(api, procurementRoutes,   "procurement");
    await withRole(api, pricingRoutes,       "procurement");
    await withRole(api, uomRoutes,           "procurement");

    // Inventory — warehouse + procurement + supervisor can all touch stock
    await withRole(api, inventoryRoutes,     "supervisor", "warehouse", "procurement");

    // Manufacturing & workforce
    await withRole(api, mfgRoutes,           "supervisor");
    await withRole(api, workforceRoutes,     "supervisor");

    // Transfers & putaway rules (warehouse + supervisor)
    await withRole(api, transfersRoutes,     "supervisor", "warehouse");
    await withRole(api, stockRulesRoutes,    "supervisor", "warehouse");

    // Reports — read access for supervisors, billing, procurement
    await withRole(api, reportsRoutes,       "supervisor", "billing", "procurement");

    // Settings — admin only (user management, company config)
    await withRole(api, settingsRoutes,      "admin");
  },
  { prefix: "/v1" }
);

try {
  await app.listen({ host: config.host, port: config.port });
  console.log(`\nNovaERP API ready · http://localhost:${config.port}/v1`);
  console.log(`Health check        · http://localhost:${config.port}/health\n`);
} catch (err) {
  app.log.error(err);
  process.exit(1);
}
