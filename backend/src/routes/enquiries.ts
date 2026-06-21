// CRM: Enquiries / leads pipeline.
//
// An Enquiry is an inbound interest captured before a Customer/Quote exists.
// It moves through a pipeline (new → contacted → qualified → proposal →
// won/lost), carries optional line items + an activity/task timeline, and can
// be converted into (or linked to) a Customer.
import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { db } from "../db.js";
import { recordChange } from "../sync/log.js";

const STAGES = ["new", "contacted", "qualified", "proposal", "won", "lost"] as const;
const TYPES = ["product", "dealership", "farm_visit", "other"] as const;
const SOURCES = [
  "walk_in", "phone", "website", "whatsapp", "referral", "exhibition", "social", "other",
] as const;
const PRIORITIES = ["low", "medium", "high"] as const;
const ACTIVITY_TYPES = [
  "note", "call", "email", "meeting", "whatsapp", "visit", "stage_change",
] as const;

const itemInput = z.object({
  productId: z.string().nullish(),
  variantId: z.string().nullish(),
  description: z.string().max(300).nullish(),
  qty: z.number().positive().default(1),
  notes: z.string().max(500).nullish(),
});

const enquiryCreate = z.object({
  type: z.enum(TYPES).default("product"),
  source: z.enum(SOURCES).default("walk_in"),
  priority: z.enum(PRIORITIES).default("medium"),
  contactName: z.string().min(1).max(160),
  phone: z.string().max(40).nullish(),
  email: z.string().email().max(160).nullish().or(z.literal("")),
  company: z.string().max(160).nullish(),
  city: z.string().max(120).nullish(),
  subject: z.string().min(1).max(200),
  requirement: z.string().max(4000).nullish(),
  estimatedValue: z.number().min(0).default(0),
  expectedCloseDate: z.string().datetime().nullish(),
  nextFollowUpAt: z.string().datetime().nullish(),
  customerId: z.string().nullish(),
  assignedToId: z.string().nullish(),
  items: z.array(itemInput).default([]),
});

const enquiryUpdate = enquiryCreate.partial().omit({ items: true });

const listInclude = {
  customer: { select: { id: true, code: true, name: true } },
  assignedTo: { select: { id: true, name: true } },
  _count: { select: { items: true, activities: true } },
} as const;

const detailInclude = {
  customer: { select: { id: true, code: true, name: true, addressLine: true, city: true, state: true, pincode: true } },
  assignedTo: { select: { id: true, name: true } },
  createdBy: { select: { id: true, name: true } },
  items: {
    include: {
      product: { select: { id: true, sku: true, name: true, uom: true } },
      variant: { select: { id: true, sku: true, size: true, color: true } },
    },
  },
  activities: {
    include: { createdBy: { select: { id: true, name: true } } },
    orderBy: { createdAt: "desc" as const },
  },
} as const;

const nextEnquiryNo = async (): Promise<string> => {
  const year = new Date().getUTCFullYear();
  const prefix = `ENQ-${year}-`;
  const last = await db.enquiry.findFirst({
    where: { enquiryNo: { startsWith: prefix } },
    orderBy: { enquiryNo: "desc" },
    select: { enquiryNo: true },
  });
  const n = last ? parseInt(last.enquiryNo.slice(prefix.length), 10) || 0 : 0;
  return `${prefix}${String(n + 1).padStart(4, "0")}`;
};

const nextCustomerCode = async (): Promise<string> => {
  const last = await db.customer.findFirst({
    where: { code: { startsWith: "CUST-" } },
    orderBy: { code: "desc" },
    select: { code: true },
  });
  const n = last ? parseInt(last.code.replace("CUST-", ""), 10) || 0 : 0;
  return `CUST-${(n + 1).toString().padStart(4, "0")}`;
};

// Recompute the denormalised nextFollowUpAt from the earliest OPEN task
// (an activity with a dueAt that hasn't been completed).
const refreshNextFollowUp = async (enquiryId: string): Promise<void> => {
  const next = await db.enquiryActivity.findFirst({
    where: { enquiryId, dueAt: { not: null }, completedAt: null },
    orderBy: { dueAt: "asc" },
    select: { dueAt: true },
  });
  await db.enquiry.update({
    where: { id: enquiryId },
    data: { nextFollowUpAt: next?.dueAt ?? null },
  });
};

export const enquiriesRoutes = async (app: FastifyInstance) => {
  // ── Stats for dashboard / header KPIs ────────────────────────────────
  app.get("/enquiries/stats", async () => {
    const open = { stage: { notIn: ["won", "lost"] } };
    const [byStage, openCount, wonCount, lostCount, pipeline, followUpsDue] =
      await Promise.all([
        db.enquiry.groupBy({ by: ["stage"], _count: { _all: true } }),
        db.enquiry.count({ where: open }),
        db.enquiry.count({ where: { stage: "won" } }),
        db.enquiry.count({ where: { stage: "lost" } }),
        db.enquiry.aggregate({ where: open, _sum: { estimatedValue: true } }),
        db.enquiry.count({
          where: { ...open, nextFollowUpAt: { lte: new Date() } },
        }),
      ]);
    return {
      byStage: Object.fromEntries(byStage.map((r) => [r.stage, r._count._all])),
      open: openCount,
      won: wonCount,
      lost: lostCount,
      pipelineValue: pipeline._sum.estimatedValue ?? 0,
      followUpsDue,
    };
  });

  // ── List with filters ────────────────────────────────────────────────
  app.get("/enquiries", async (req) => {
    const q = (req.query as Record<string, string>) ?? {};
    const where: Record<string, unknown> = {};
    if (q.stage) where.stage = q.stage;
    if (q.type) where.type = q.type;
    if (q.assignedToId) where.assignedToId = q.assignedToId;
    if (q.q) {
      where.OR = [
        { enquiryNo: { contains: q.q } },
        { contactName: { contains: q.q } },
        { company: { contains: q.q } },
        { subject: { contains: q.q } },
        { phone: { contains: q.q } },
      ];
    }
    if (q.followUpsDue === "1") {
      where.stage = { notIn: ["won", "lost"] };
      where.nextFollowUpAt = { lte: new Date() };
    }
    return db.enquiry.findMany({
      where,
      include: listInclude,
      orderBy: [{ updatedAt: "desc" }],
      take: q.limit ? Math.min(parseInt(q.limit, 10) || 200, 500) : 200,
    });
  });

  app.get("/enquiries/:id", async (req, reply) => {
    const id = (req.params as { id: string }).id;
    const e = await db.enquiry.findUnique({ where: { id }, include: detailInclude });
    if (!e) return reply.code(404).send({ error: { code: "not_found" } });
    return e;
  });

  // ── Create ───────────────────────────────────────────────────────────
  app.post("/enquiries", async (req, reply) => {
    const body = enquiryCreate.parse(req.body);
    const enquiryNo = await nextEnquiryNo();
    const created = await db.enquiry.create({
      data: {
        enquiryNo,
        type: body.type,
        source: body.source,
        priority: body.priority,
        contactName: body.contactName,
        phone: body.phone ?? null,
        email: body.email ? body.email : null,
        company: body.company ?? null,
        city: body.city ?? null,
        subject: body.subject,
        requirement: body.requirement ?? null,
        estimatedValue: body.estimatedValue,
        expectedCloseDate: body.expectedCloseDate ? new Date(body.expectedCloseDate) : null,
        nextFollowUpAt: body.nextFollowUpAt ? new Date(body.nextFollowUpAt) : null,
        customerId: body.customerId ?? null,
        assignedToId: body.assignedToId ?? null,
        createdById: req.user.sub,
        items: {
          create: body.items.map((it) => ({
            productId: it.productId ?? null,
            variantId: it.variantId ?? null,
            description: it.description ?? null,
            qty: it.qty,
            notes: it.notes ?? null,
          })),
        },
        activities: {
          create: {
            type: "note",
            body: `Enquiry created (${body.type}).`,
            createdById: req.user.sub,
          },
        },
      },
      include: detailInclude,
    });
    await recordChange("Enquiry", created.id, "insert", created, req.user.sub);
    return reply.code(201).send(created);
  });

  // ── Update header fields ─────────────────────────────────────────────
  app.patch("/enquiries/:id", async (req, reply) => {
    const id = (req.params as { id: string }).id;
    const before = await db.enquiry.findUnique({ where: { id } });
    if (!before) return reply.code(404).send({ error: { code: "not_found" } });
    const body = enquiryUpdate.parse(req.body);
    const updated = await db.enquiry.update({
      where: { id },
      data: {
        ...(body.type !== undefined ? { type: body.type } : {}),
        ...(body.source !== undefined ? { source: body.source } : {}),
        ...(body.priority !== undefined ? { priority: body.priority } : {}),
        ...(body.contactName !== undefined ? { contactName: body.contactName } : {}),
        ...(body.phone !== undefined ? { phone: body.phone ?? null } : {}),
        ...(body.email !== undefined ? { email: body.email ? body.email : null } : {}),
        ...(body.company !== undefined ? { company: body.company ?? null } : {}),
        ...(body.city !== undefined ? { city: body.city ?? null } : {}),
        ...(body.subject !== undefined ? { subject: body.subject } : {}),
        ...(body.requirement !== undefined ? { requirement: body.requirement ?? null } : {}),
        ...(body.estimatedValue !== undefined ? { estimatedValue: body.estimatedValue } : {}),
        ...(body.expectedCloseDate !== undefined
          ? { expectedCloseDate: body.expectedCloseDate ? new Date(body.expectedCloseDate) : null }
          : {}),
        ...(body.customerId !== undefined ? { customerId: body.customerId ?? null } : {}),
        ...(body.assignedToId !== undefined ? { assignedToId: body.assignedToId ?? null } : {}),
      },
      include: detailInclude,
    });
    await recordChange("Enquiry", id, "update", updated, req.user.sub);
    return updated;
  });

  // ── Replace line items ───────────────────────────────────────────────
  app.put("/enquiries/:id/items", async (req, reply) => {
    const id = (req.params as { id: string }).id;
    const before = await db.enquiry.findUnique({ where: { id } });
    if (!before) return reply.code(404).send({ error: { code: "not_found" } });
    const body = z.object({ items: z.array(itemInput) }).parse(req.body);
    await db.$transaction([
      db.enquiryItem.deleteMany({ where: { enquiryId: id } }),
      db.enquiryItem.createMany({
        data: body.items.map((it) => ({
          enquiryId: id,
          productId: it.productId ?? null,
          variantId: it.variantId ?? null,
          description: it.description ?? null,
          qty: it.qty,
          notes: it.notes ?? null,
        })),
      }),
    ]);
    return db.enquiry.findUnique({ where: { id }, include: detailInclude });
  });

  // ── Stage transition ─────────────────────────────────────────────────
  app.patch("/enquiries/:id/stage", async (req, reply) => {
    const id = (req.params as { id: string }).id;
    const before = await db.enquiry.findUnique({ where: { id } });
    if (!before) return reply.code(404).send({ error: { code: "not_found" } });
    const body = z
      .object({ stage: z.enum(STAGES), lostReason: z.string().max(500).nullish() })
      .parse(req.body);

    if (body.stage === before.stage) {
      return db.enquiry.findUnique({ where: { id }, include: detailInclude });
    }

    const now = new Date();
    const updated = await db.enquiry.update({
      where: { id },
      data: {
        stage: body.stage,
        wonAt: body.stage === "won" ? now : before.wonAt,
        lostAt: body.stage === "lost" ? now : before.lostAt,
        lostReason: body.stage === "lost" ? body.lostReason ?? before.lostReason : before.lostReason,
        activities: {
          create: {
            type: "stage_change",
            body: `Stage: ${before.stage} → ${body.stage}` +
              (body.stage === "lost" && body.lostReason ? ` (reason: ${body.lostReason})` : ""),
            createdById: req.user.sub,
          },
        },
      },
      include: detailInclude,
    });
    await recordChange("Enquiry", id, "update", updated, req.user.sub);
    return updated;
  });

  // ── Add an activity / follow-up task ─────────────────────────────────
  app.post("/enquiries/:id/activities", async (req, reply) => {
    const id = (req.params as { id: string }).id;
    const before = await db.enquiry.findUnique({ where: { id } });
    if (!before) return reply.code(404).send({ error: { code: "not_found" } });
    const body = z
      .object({
        type: z.enum(ACTIVITY_TYPES).default("note"),
        body: z.string().min(1).max(2000),
        outcome: z.string().max(500).nullish(),
        dueAt: z.string().datetime().nullish(),
      })
      .parse(req.body);
    const act = await db.enquiryActivity.create({
      data: {
        enquiryId: id,
        type: body.type,
        body: body.body,
        outcome: body.outcome ?? null,
        dueAt: body.dueAt ? new Date(body.dueAt) : null,
        createdById: req.user.sub,
      },
      include: { createdBy: { select: { id: true, name: true } } },
    });
    if (body.dueAt) await refreshNextFollowUp(id);
    return reply.code(201).send(act);
  });

  // ── Complete a follow-up task ────────────────────────────────────────
  app.patch("/enquiries/:id/activities/:actId/complete", async (req, reply) => {
    const { id, actId } = req.params as { id: string; actId: string };
    const act = await db.enquiryActivity.findFirst({ where: { id: actId, enquiryId: id } });
    if (!act) return reply.code(404).send({ error: { code: "not_found" } });
    const updated = await db.enquiryActivity.update({
      where: { id: actId },
      data: { completedAt: new Date() },
      include: { createdBy: { select: { id: true, name: true } } },
    });
    await refreshNextFollowUp(id);
    return updated;
  });

  // ── Convert: create or link a Customer ───────────────────────────────
  app.post("/enquiries/:id/convert", async (req, reply) => {
    const id = (req.params as { id: string }).id;
    const enquiry = await db.enquiry.findUnique({ where: { id } });
    if (!enquiry) return reply.code(404).send({ error: { code: "not_found" } });

    const body = z
      .object({
        // Either link an existing customer …
        customerId: z.string().nullish(),
        // … or create a new one from these fields (defaults from the enquiry).
        name: z.string().max(160).nullish(),
        gst: z.string().max(20).nullish(),
        city: z.string().max(120).nullish(),
        contact: z.string().max(160).nullish(),
        priceListId: z.string().nullish(),
        creditLimit: z.number().min(0).nullish(),
        markWon: z.boolean().default(true),
      })
      .parse(req.body ?? {});

    let customerId = body.customerId ?? enquiry.customerId ?? null;

    if (!customerId) {
      const code = await nextCustomerCode();
      const customer = await db.customer.create({
        data: {
          code,
          name: body.name || enquiry.company || enquiry.contactName,
          gst: body.gst ?? null,
          city: body.city ?? enquiry.city ?? null,
          contact: body.contact ?? enquiry.phone ?? null,
          priceListId: body.priceListId ?? null,
          creditLimit: body.creditLimit ?? 0,
        },
      });
      customerId = customer.id;
      await recordChange("Customer", customer.id, "insert", customer, req.user.sub);
    }

    const updated = await db.enquiry.update({
      where: { id },
      data: {
        customerId,
        ...(body.markWon ? { stage: "won", wonAt: enquiry.wonAt ?? new Date() } : {}),
        activities: {
          create: {
            type: "note",
            body: body.customerId || enquiry.customerId
              ? `Linked to existing customer.`
              : `Converted to new customer.`,
            createdById: req.user.sub,
          },
        },
      },
      include: detailInclude,
    });
    await recordChange("Enquiry", id, "update", updated, req.user.sub);
    return { enquiry: updated, customerId };
  });

  // ── Delete ───────────────────────────────────────────────────────────
  app.delete("/enquiries/:id", async (req, reply) => {
    const id = (req.params as { id: string }).id;
    const before = await db.enquiry.findUnique({ where: { id } });
    if (!before) return reply.code(404).send({ error: { code: "not_found" } });
    await db.enquiry.delete({ where: { id } });
    await recordChange("Enquiry", id, "delete", before, req.user.sub);
    return reply.code(200).send({ ok: true });
  });
};
