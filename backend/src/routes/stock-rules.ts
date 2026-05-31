import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { db } from "../db.js";
import { recordChange } from "../sync/log.js";
import { checkAllStockRules, checkStockRules } from "../lib/stock-rules.js";

const requireWriter = (
  req: { user: { role: string } },
  reply: { code: (n: number) => { send: (b: unknown) => unknown } }
) => {
  if (req.user.role === "admin" || req.user.role === "supervisor") return true;
  reply.code(403).send({ error: { code: "forbidden" } });
  return false;
};

const stockRuleCreate = z.object({
  productId: z.string().min(1),
  variantId: z.string().nullable().optional(),
  monitorBinId: z.string().min(1),
  minQty: z.number().positive(),
  triggerType: z.enum(["mo", "transfer"]),
  bomId: z.string().nullable().optional(),
  sourceBinId: z.string().nullable().optional(),
  toWarehouseId: z.string().nullable().optional(),
  toBinId: z.string().nullable().optional(),
  tags: z.string().nullable().optional(),
  active: z.boolean().default(true),
  notes: z.string().nullable().optional(),
});

const stockRuleUpdate = stockRuleCreate.partial();

const ruleInclude = {
  product: { select: { id: true, sku: true, name: true } },
  variant: { select: { id: true, sku: true, size: true, color: true } },
  monitorBin: {
    select: {
      id: true,
      zone: true,
      shelf: true,
      bin: true,
      qty: true,
      warehouse: { select: { id: true, code: true } },
    },
  },
  bom: { select: { id: true, revision: true, outputQty: true } },
  sourceBin: {
    select: {
      id: true,
      zone: true,
      shelf: true,
      bin: true,
      warehouse: { select: { code: true } },
    },
  },
  toBin: {
    select: {
      id: true,
      zone: true,
      shelf: true,
      bin: true,
      warehouse: { select: { code: true } },
    },
  },
  toWarehouse: { select: { id: true, code: true, name: true } },
} as const;

export const stockRulesRoutes = async (app: FastifyInstance) => {
  app.get("/stock-rules", { preHandler: [app.authenticate] }, async (req) => {
    const q = (req.query as Record<string, string>) ?? {};
    return db.stockRule.findMany({
      where: {
        ...(q.productId ? { productId: q.productId } : {}),
        ...(q.variantId ? { variantId: q.variantId } : {}),
        ...(q.active === "1" ? { active: true } : {}),
        ...(q.active === "0" ? { active: false } : {}),
      },
      orderBy: [{ productId: "asc" }, { variantId: "asc" }],
      include: ruleInclude,
    });
  });

  app.post("/stock-rules", { preHandler: [app.authenticate] }, async (req, reply) => {
    if (!requireWriter(req, reply)) return;
    const body = stockRuleCreate.parse(req.body);
    if (body.triggerType === "mo" && !body.bomId) {
      return reply.code(400).send({
        error: { code: "validation", message: "bomId is required for mo triggers." },
      });
    }
    if (body.triggerType === "transfer" && !body.sourceBinId) {
      return reply.code(400).send({
        error: {
          code: "validation",
          message: "sourceBinId is required for transfer triggers.",
        },
      });
    }
    const created = await db.stockRule.create({ data: body, include: ruleInclude });
    await recordChange("StockRule", created.id, "insert", created, req.user.sub);
    return created;
  });

  app.patch(
    "/stock-rules/:id",
    { preHandler: [app.authenticate] },
    async (req, reply) => {
      if (!requireWriter(req, reply)) return;
      const id = (req.params as { id: string }).id;
      const body = stockRuleUpdate.parse(req.body);
      const existing = await db.stockRule.findUnique({ where: { id } });
      if (!existing) return reply.code(404).send({ error: { code: "not_found" } });
      const updated = await db.stockRule.update({
        where: { id },
        data: body,
        include: ruleInclude,
      });
      await recordChange("StockRule", id, "update", updated, req.user.sub);
      return updated;
    }
  );

  app.delete(
    "/stock-rules/:id",
    { preHandler: [app.authenticate] },
    async (req, reply) => {
      if (!requireWriter(req, reply)) return;
      const id = (req.params as { id: string }).id;
      const existing = await db.stockRule.findUnique({ where: { id } });
      if (!existing) return reply.code(404).send({ error: { code: "not_found" } });
      await db.stockRule.delete({ where: { id } });
      await recordChange("StockRule", id, "delete", existing, req.user.sub);
      return { deleted: true };
    }
  );

  app.post(
    "/stock-rules/check-all",
    { preHandler: [app.authenticate] },
    async (req, reply) => {
      if (!requireWriter(req, reply)) return;
      const results = await checkAllStockRules(req.user.sub);
      const triggered = results.filter((r) => r.created);
      return { checked: results.length, triggered: triggered.length, results };
    }
  );
};
