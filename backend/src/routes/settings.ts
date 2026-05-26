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
};
