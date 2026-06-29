import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { db } from "../db.js";

const listQuerySchema = z.object({
  level: z.enum(["error", "warn", "info"]).optional(),
  source: z
    .enum(["shiprocket", "storefront", "razorpay", "payu", "otp", "sms", "billing"])
    .optional(),
  q: z.string().trim().max(120).optional(),
  limit: z.coerce.number().int().min(1).max(200).default(50),
  before: z.string().datetime().optional(),
});

export const adminLogsRoutes = async (app: FastifyInstance) => {
  app.get("/admin/system-logs", { preHandler: [app.requireRole("admin")] }, async (req) => {
    const q = listQuerySchema.parse(req.query);
    const where: {
      level?: string;
      source?: string;
      createdAt?: { lt: Date };
      OR?: Array<{ message?: { contains: string }; refId?: { contains: string } }>;
    } = {};

    if (q.level) where.level = q.level;
    if (q.source) where.source = q.source;
    if (q.before) where.createdAt = { lt: new Date(q.before) };
    if (q.q) {
      where.OR = [
        { message: { contains: q.q } },
        { refId: { contains: q.q } },
      ];
    }

    const rows = await db.systemEventLog.findMany({
      where,
      orderBy: { createdAt: "desc" },
      take: q.limit,
    });

    return {
      rows: rows.map((r) => ({
        id: r.id,
        level: r.level,
        source: r.source,
        action: r.action,
        message: r.message,
        context: r.context ? safeParseJson(r.context) : null,
        refId: r.refId,
        createdAt: r.createdAt.toISOString(),
      })),
      nextBefore: rows.length > 0 ? rows[rows.length - 1].createdAt.toISOString() : null,
    };
  });

  app.get("/admin/system-logs/summary", { preHandler: [app.requireRole("admin")] }, async () => {
    const since = new Date(Date.now() - 24 * 60 * 60 * 1000);
    const rows = await db.systemEventLog.groupBy({
      by: ["source", "level"],
      where: { createdAt: { gte: since } },
      _count: { _all: true },
    });

    const recentErrors = await db.systemEventLog.findMany({
      where: { level: "error", createdAt: { gte: since } },
      orderBy: { createdAt: "desc" },
      take: 5,
      select: {
        id: true,
        source: true,
        action: true,
        message: true,
        refId: true,
        createdAt: true,
      },
    });

    return {
      since: since.toISOString(),
      counts: rows.map((r) => ({
        source: r.source,
        level: r.level,
        count: r._count._all,
      })),
      recentErrors: recentErrors.map((r) => ({
        ...r,
        createdAt: r.createdAt.toISOString(),
      })),
    };
  });

  app.get("/admin/payment-intents", { preHandler: [app.requireRole("admin")] }, async (req) => {
    const q = z
      .object({
        status: z.enum(["created", "paid", "failed", "abandoned"]).optional(),
        limit: z.coerce.number().int().min(1).max(100).default(30),
      })
      .parse(req.query);

    const rows = await db.paymentIntent.findMany({
      where: q.status ? { status: q.status } : undefined,
      orderBy: { createdAt: "desc" },
      take: q.limit,
      select: {
        id: true,
        gateway: true,
        gatewayOrderId: true,
        gatewayPaymentId: true,
        amount: true,
        status: true,
        email: true,
        phone: true,
        salesOrderId: true,
        createdAt: true,
        updatedAt: true,
      },
    });

    return {
      rows: rows.map((r) => ({
        ...r,
        createdAt: r.createdAt.toISOString(),
        updatedAt: r.updatedAt.toISOString(),
      })),
    };
  });

  // ── Customer Activity ──────────────────────────────────────────────────────
  const activityQuerySchema = z.object({
    customerId: z.string().trim().optional(),
    anonId: z.string().trim().optional(),
    event: z.string().trim().optional(),
    from: z.string().datetime().optional(),
    to: z.string().datetime().optional(),
    limit: z.coerce.number().int().min(1).max(200).default(50),
  });

  app.get(
    "/admin/customer-activity",
    { preHandler: [app.requireRole("admin")] },
    async (req) => {
      const q = activityQuerySchema.parse(req.query);
      const where: Record<string, unknown> = {};
      if (q.customerId) where["customerId"] = q.customerId;
      if (q.anonId) where["anonId"] = q.anonId;
      if (q.event) where["event"] = q.event;
      if (q.from || q.to) {
        where["createdAt"] = {
          ...(q.from ? { gte: new Date(q.from) } : {}),
          ...(q.to ? { lte: new Date(q.to) } : {}),
        };
      }
      const rows = await db.customerActivity.findMany({
        where,
        orderBy: { createdAt: "desc" },
        take: q.limit,
      });
      return { rows: rows.map((r) => ({ ...r, createdAt: r.createdAt.toISOString() })) };
    }
  );

  app.get(
    "/admin/customer-activity/timeline/:customerId",
    { preHandler: [app.requireRole("admin")] },
    async (req) => {
      const { customerId } = req.params as { customerId: string };
      // Gather all anonIds used by this customer so pre-login pageviews are included.
      const withCustomerId = await db.customerActivity.findMany({
        where: { customerId },
        select: { anonId: true },
        distinct: ["anonId"],
      });
      const anonIds = [...new Set(withCustomerId.map((r) => r.anonId))];

      const rows = await db.customerActivity.findMany({
        where: {
          OR: [
            { customerId },
            ...(anonIds.length > 0 ? [{ anonId: { in: anonIds } }] : []),
          ],
        },
        orderBy: { createdAt: "asc" },
        take: 500,
      });
      return { rows: rows.map((r) => ({ ...r, createdAt: r.createdAt.toISOString() })) };
    }
  );
};

const safeParseJson = (raw: string): unknown => {
  try {
    return JSON.parse(raw) as unknown;
  } catch {
    return raw;
  }
};
