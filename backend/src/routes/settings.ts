// Settings & deployment-wide configuration.
//
// Currently exposes the singleton CompanyProfile (legal name, GSTIN, address,
// banking details) used on invoices, quotes, the public quote viewer and SMS.
// We use a single fixed key ("default") so there is exactly one row; the GET
// endpoint lazy-initialises it with sensible Indian-SMB defaults if missing,
// so the UI never has to deal with a 404.
import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { db } from "../db.js";
import { recordChange } from "../sync/log.js";
import {
  DISPATCH_CATEGORIES,
  ensureDefaultDispatchOptions,
} from "../lib/dispatch-options-seed.js";
import {
  CONTAINER_KINDS,
  ensureDefaultContainerTypes,
} from "../lib/container-types-seed.js";

const SINGLETON_KEY = "default";

// All editable fields are optional on PUT — partial updates are encouraged so
// the UI doesn't have to round-trip every field. Strings are normalised to
// null when the client sends an empty string (so "—" rendering works cleanly).
const profileInput = z.object({
  legalName: z.string().min(1).max(200).optional(),
  tradeName: z.string().max(200).nullable().optional(),
  gstin: z.string().max(32).nullable().optional(),
  pan: z.string().max(16).nullable().optional(),
  cin: z.string().max(32).nullable().optional(),
  industry: z.string().max(100).nullable().optional(),
  addressLine: z.string().max(500).nullable().optional(),
  city: z.string().max(100).nullable().optional(),
  state: z.string().max(100).nullable().optional(),
  pincode: z.string().max(16).nullable().optional(),
  country: z.string().max(100).optional(),
  phone: z.string().max(40).nullable().optional(),
  email: z.string().email().nullable().optional().or(z.literal("")),
  website: z.string().max(200).nullable().optional(),
  logoUrl: z.string().max(500).nullable().optional(),
  invoicePrefix: z.string().min(1).max(10).optional(),
  quotePrefix: z.string().min(1).max(10).optional(),
  currency: z.string().min(1).max(8).optional(),
  fiscalYearStart: z
    .string()
    .regex(/^\d{2}-\d{2}$/, "expected MM-DD")
    .optional(),
  defaultTaxRate: z.number().min(0).max(100).optional(),
  termsDefault: z.string().max(2000).nullable().optional(),
  bankName: z.string().max(100).nullable().optional(),
  bankAccountNo: z.string().max(40).nullable().optional(),
  bankIfsc: z.string().max(20).nullable().optional(),
  bankBranch: z.string().max(200).nullable().optional(),
  upi: z.string().max(80).nullable().optional(),
  // Manufacturing / fulfilment toggles. Kept on CompanyProfile to stay
  // singleton — multi-container packing affects both desktop and mobile
  // flows and a single switch keeps every device coherent.
  requireMoReleaseBeforeIssue: z.boolean().optional(),
  packMultiContainerEnabled: z.boolean().optional(),
  packRequireSealConfirmation: z.boolean().optional(),
});

// Reasonable starter values. The UI shows these the very first time
// somebody opens Settings, so the form isn't an empty void.
const DEFAULT_PROFILE = {
  legalName: "Your Company Pvt Ltd",
  tradeName: null,
  gstin: null,
  pan: null,
  cin: null,
  industry: null,
  addressLine: null,
  city: null,
  state: "Maharashtra",
  pincode: null,
  country: "India",
  phone: null,
  email: null,
  website: null,
  logoUrl: null,
  invoicePrefix: "INV",
  quotePrefix: "Q",
  currency: "INR",
  fiscalYearStart: "04-01",
  defaultTaxRate: 18,
  termsDefault: null,
  bankName: null,
  bankAccountNo: null,
  bankIfsc: null,
  bankBranch: null,
  upi: null,
};

// Public-safe projection — strips bank/UPI details so we don't leak account
// numbers to anyone who has a quote share link. Used by /v1/public/company.
const publicProjection = (p: Record<string, unknown>) => ({
  legalName: p.legalName,
  tradeName: p.tradeName,
  gstin: p.gstin,
  addressLine: p.addressLine,
  city: p.city,
  state: p.state,
  pincode: p.pincode,
  country: p.country,
  phone: p.phone,
  email: p.email,
  website: p.website,
  logoUrl: p.logoUrl,
});

export const settingsRoutes = async (app: FastifyInstance) => {
  // -- GET company profile (authenticated). Lazy-init on first read so
  // a fresh deployment never returns 404.
  app.get(
    "/settings/company",
    { preHandler: [app.authenticate] },
    async () => {
      const existing = await db.companyProfile.findUnique({
        where: { key: SINGLETON_KEY },
      });
      if (existing) return existing;
      return db.companyProfile.create({
        data: { key: SINGLETON_KEY, ...DEFAULT_PROFILE },
      });
    }
  );

  // -- PUT company profile. Upsert against the singleton key; only
  // admin/supervisor roles may persist changes.
  app.put(
    "/settings/company",
    { preHandler: [app.authenticate] },
    async (req, reply) => {
      const role = req.user.role;
      if (role !== "admin" && role !== "supervisor") {
        return reply.code(403).send({
          error: { code: "forbidden", message: "Admins only" },
        });
      }
      const body = profileInput.parse(req.body);
      // Empty string for email -> null (Prisma keeps it nullable).
      if (body.email === "") body.email = null;
      const updated = await db.companyProfile.upsert({
        where: { key: SINGLETON_KEY },
        update: body,
        create: { key: SINGLETON_KEY, ...DEFAULT_PROFILE, ...body },
      });
      await recordChange(
        "CompanyProfile",
        updated.id,
        "update",
        updated,
        req.user.sub
      );
      return updated;
    }
  );

  // -- Public, unauthenticated read used by the share/quote viewer
  // and the printable invoice page. Excludes banking details.
  app.get("/public/company", async () => {
    const existing = await db.companyProfile.findUnique({
      where: { key: SINGLETON_KEY },
    });
    if (!existing) {
      return publicProjection({ ...DEFAULT_PROFILE });
    }
    return publicProjection(existing as unknown as Record<string, unknown>);
  });

  // -- Dispatch options (admin CRUD) ----------------------------------------
  const dispatchInput = z.object({
    code: z.string().min(1).max(64).regex(/^[a-z0-9_]+$/, "lowercase letters, digits, underscores"),
    name: z.string().min(1).max(120),
    category: z.string().min(1).max(64),
    description: z.string().max(500).nullable().optional(),
    defaultCharge: z.number().nonnegative().default(0),
    active: z.boolean().default(true),
    sortOrder: z.number().int().default(0),
  });

  const dispatchUpdate = dispatchInput.partial();

  app.get(
    "/settings/dispatch-options",
    { preHandler: [app.authenticate] },
    async () => {
      await ensureDefaultDispatchOptions(db);
      return db.dispatchOption.findMany({
        orderBy: [{ sortOrder: "asc" }, { name: "asc" }],
      });
    }
  );

  app.get(
    "/settings/dispatch-categories",
    { preHandler: [app.authenticate] },
    async () => DISPATCH_CATEGORIES
  );

  app.post(
    "/settings/dispatch-options",
    { preHandler: [app.authenticate] },
    async (req, reply) => {
      if (req.user.role !== "admin" && req.user.role !== "supervisor") {
        return reply.code(403).send({ error: { code: "forbidden" } });
      }
      const body = dispatchInput.parse(req.body);
      const created = await db.dispatchOption.create({ data: body });
      await recordChange("DispatchOption", created.id, "insert", created, req.user.sub);
      return created;
    }
  );

  app.patch(
    "/settings/dispatch-options/:id",
    { preHandler: [app.authenticate] },
    async (req, reply) => {
      if (req.user.role !== "admin" && req.user.role !== "supervisor") {
        return reply.code(403).send({ error: { code: "forbidden" } });
      }
      const { id } = req.params as { id: string };
      const body = dispatchUpdate.parse(req.body);
      const updated = await db.dispatchOption.update({ where: { id }, data: body });
      await recordChange("DispatchOption", id, "update", updated, req.user.sub);
      return updated;
    }
  );

  app.delete(
    "/settings/dispatch-options/:id",
    { preHandler: [app.authenticate] },
    async (req, reply) => {
      if (req.user.role !== "admin" && req.user.role !== "supervisor") {
        return reply.code(403).send({ error: { code: "forbidden" } });
      }
      const { id } = req.params as { id: string };
      const inUse = await db.quote.count({ where: { dispatchOptionId: id } });
      if (inUse > 0) {
        return reply.code(409).send({
          error: {
            code: "in_use",
            message: "Dispatch option is referenced by quotes. Deactivate instead.",
          },
        });
      }
      await db.dispatchOption.delete({ where: { id } });
      await recordChange("DispatchOption", id, "delete", { id }, req.user.sub);
      return { ok: true };
    }
  );

  // -- Container types (admin CRUD) -----------------------------------------
  // Drives the picker on every "Add container" action in the desktop
  // Packing Slip editor and the mobile MobilePack screen. Lazy-seeded
  // with sensible defaults on first read.
  const containerKindSchema = z.enum(CONTAINER_KINDS);
  const containerTypeInput = z.object({
    code: z
      .string()
      .min(1)
      .max(32)
      .regex(/^[A-Z0-9_-]+$/, "Use uppercase letters, digits, hyphens or underscores"),
    name: z.string().min(1).max(120),
    kind: containerKindSchema,
    tareKg: z.number().min(0).max(500).default(0),
    maxKg: z.number().positive().max(2000).nullable().optional(),
    active: z.boolean().default(true),
    sortOrder: z.number().int().default(100),
  });
  const containerTypeUpdate = containerTypeInput.partial();

  app.get(
    "/settings/container-types",
    { preHandler: [app.authenticate] },
    async () => {
      await ensureDefaultContainerTypes(db);
      return db.containerType.findMany({
        orderBy: [{ sortOrder: "asc" }, { name: "asc" }],
      });
    }
  );

  app.get(
    "/settings/container-kinds",
    { preHandler: [app.authenticate] },
    async () => CONTAINER_KINDS
  );

  app.post(
    "/settings/container-types",
    { preHandler: [app.authenticate] },
    async (req, reply) => {
      if (req.user.role !== "admin" && req.user.role !== "supervisor") {
        return reply.code(403).send({ error: { code: "forbidden" } });
      }
      const body = containerTypeInput.parse(req.body);
      const created = await db.containerType.create({ data: body });
      await recordChange("ContainerType", created.id, "insert", created, req.user.sub);
      return created;
    }
  );

  app.patch(
    "/settings/container-types/:id",
    { preHandler: [app.authenticate] },
    async (req, reply) => {
      if (req.user.role !== "admin" && req.user.role !== "supervisor") {
        return reply.code(403).send({ error: { code: "forbidden" } });
      }
      const { id } = req.params as { id: string };
      const body = containerTypeUpdate.parse(req.body);
      const updated = await db.containerType.update({ where: { id }, data: body });
      await recordChange("ContainerType", id, "update", updated, req.user.sub);
      return updated;
    }
  );

  app.delete(
    "/settings/container-types/:id",
    { preHandler: [app.authenticate] },
    async (req, reply) => {
      if (req.user.role !== "admin" && req.user.role !== "supervisor") {
        return reply.code(403).send({ error: { code: "forbidden" } });
      }
      const { id } = req.params as { id: string };
      const inUse = await db.packingContainer.count({ where: { containerTypeId: id } });
      if (inUse > 0) {
        return reply.code(409).send({
          error: {
            code: "in_use",
            message:
              "Container type is referenced by packing slips. Deactivate instead.",
          },
        });
      }
      await db.containerType.delete({ where: { id } });
      await recordChange("ContainerType", id, "delete", { id }, req.user.sub);
      return { ok: true };
    }
  );
};
