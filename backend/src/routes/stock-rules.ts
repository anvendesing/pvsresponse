import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { db } from "../db.js";
import { recordChange } from "../sync/log.js";
import { checkAllStockRules } from "../lib/stock-rules.js";
import {
  getEffectiveBinStock,
  getEffectiveProductStock,
} from "../lib/stock-rule-pipeline.js";

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
  monitorBinId: z.string().nullable().optional(),
  minQty: z.coerce.number().positive(),
  maxQty: z.coerce.number().positive().nullable().optional(),
  orderMultiple: z.coerce.number().positive().nullable().optional(),
  triggerType: z.enum(["mo", "transfer", "po"]),
  vendorId: z.string().nullable().optional(),
  bomId: z.string().nullable().optional(),
  sourceBinId: z.string().nullable().optional(),
  toWarehouseId: z.string().nullable().optional(),
  toBinId: z.string().nullable().optional(),
  tags: z.string().nullable().optional(),
  active: z.coerce.boolean().default(true),
  notes: z.string().nullable().optional(),
});

const stockRuleUpdate = stockRuleCreate.partial();

type StockRulePayload = z.infer<typeof stockRuleCreate>;

const normalizePoOptionalQty = (row: {
  maxQty?: number | null;
  orderMultiple?: number | null;
}) => {
  if (row.maxQty != null && row.maxQty <= 0) row.maxQty = null;
  if (row.orderMultiple != null && row.orderMultiple <= 0) row.orderMultiple = null;
};

const validateStockRulePayload = (
  body: StockRulePayload,
  reply: { code: (n: number) => { send: (b: unknown) => unknown } }
): boolean => {
  if (body.triggerType === "mo") {
    if (!body.monitorBinId) {
      reply.code(400).send({
        error: { code: "validation", message: "monitorBinId is required for mo triggers." },
      });
      return false;
    }
    if (!body.bomId) {
      reply.code(400).send({
        error: { code: "validation", message: "bomId is required for mo triggers." },
      });
      return false;
    }
  }
  if (body.triggerType === "transfer") {
    if (!body.monitorBinId) {
      reply.code(400).send({
        error: {
          code: "validation",
          message: "monitorBinId is required for transfer triggers.",
        },
      });
      return false;
    }
    if (!body.sourceBinId) {
      reply.code(400).send({
        error: {
          code: "validation",
          message: "sourceBinId is required for transfer triggers.",
        },
      });
      return false;
    }
  }
  if (body.triggerType === "po") {
    if (!body.vendorId) {
      reply.code(400).send({
        error: { code: "validation", message: "vendorId is required for po triggers." },
      });
      return false;
    }
  }
  return true;
};

const finalizeStockRuleData = (body: StockRulePayload) => {
  if (body.triggerType === "po") {
    normalizePoOptionalQty(body);
    return {
      ...body,
      monitorBinId: null,
      bomId: null,
      sourceBinId: null,
      toBinId: null,
      vendorId: body.vendorId ?? null,
      maxQty: body.maxQty ?? null,
      orderMultiple: body.orderMultiple ?? null,
    };
  }
  if (body.triggerType === "mo") {
    normalizePoOptionalQty(body);
    return {
      ...body,
      vendorId: null,
      orderMultiple: null,
      sourceBinId: null,
      monitorBinId: body.monitorBinId ?? null,
      bomId: body.bomId ?? null,
      toBinId: body.toBinId ?? body.monitorBinId ?? null,
      maxQty: body.maxQty ?? null,
    };
  }
  return {
    ...body,
    vendorId: null,
    maxQty: null,
    orderMultiple: null,
    bomId: null,
    monitorBinId: body.monitorBinId ?? null,
    sourceBinId: body.sourceBinId ?? null,
    toBinId: body.toBinId ?? body.monitorBinId ?? null,
  };
};

const ruleInclude = {
  product: { select: { id: true, sku: true, name: true, barcode: true } },
  variant: {
    select: { id: true, sku: true, size: true, color: true, barcode: true },
  },
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
  vendor: { select: { id: true, code: true, name: true } },
} as const;

export const stockRulesRoutes = async (app: FastifyInstance) => {
  app.get("/stock-rules", { preHandler: [app.authenticate] }, async (req) => {
    const q = (req.query as Record<string, string>) ?? {};
    const rows = await db.stockRule.findMany({
      where: {
        ...(q.productId ? { productId: q.productId } : {}),
        ...(q.variantId ? { variantId: q.variantId } : {}),
        ...(q.active === "1" ? { active: true } : {}),
        ...(q.active === "0" ? { active: false } : {}),
      },
      orderBy: [{ productId: "asc" }, { variantId: "asc" }],
      include: ruleInclude,
    });
    return Promise.all(
      rows.map(async (r) => {
        const effectiveStock = r.monitorBin
          ? await getEffectiveBinStock(r.monitorBin.qty, r.productId, r.variantId)
          : await getEffectiveProductStock(r.productId, r.variantId);
        return { ...r, effectiveStock };
      })
    );
  });

  app.post("/stock-rules", { preHandler: [app.authenticate] }, async (req, reply) => {
    if (!requireWriter(req, reply)) return;
    const body = stockRuleCreate.parse(req.body);
    if (!validateStockRulePayload(body, reply)) return;
    const data = finalizeStockRuleData(body);
    const created = await db.stockRule.create({
      data: {
        ...data,
        variantId: data.variantId ?? null,
      },
      include: ruleInclude,
    });
    await recordChange("StockRule", created.id, "insert", created, req.user.sub);
    return created;
  });

  app.patch(
    "/stock-rules/:id",
    { preHandler: [app.authenticate] },
    async (req, reply) => {
      if (!requireWriter(req, reply)) return;
      const id = (req.params as { id: string }).id;
      const patch = stockRuleUpdate.parse(req.body);
      const existing = await db.stockRule.findUnique({ where: { id } });
      if (!existing) return reply.code(404).send({ error: { code: "not_found" } });
      const merged = stockRuleCreate.parse({
        productId: patch.productId ?? existing.productId,
        variantId: patch.variantId !== undefined ? patch.variantId : existing.variantId,
        monitorBinId:
          patch.monitorBinId !== undefined ? patch.monitorBinId : existing.monitorBinId,
        minQty: patch.minQty ?? existing.minQty,
        maxQty: patch.maxQty !== undefined ? patch.maxQty : existing.maxQty,
        orderMultiple:
          patch.orderMultiple !== undefined ? patch.orderMultiple : existing.orderMultiple,
        triggerType: patch.triggerType ?? existing.triggerType,
        vendorId: patch.vendorId !== undefined ? patch.vendorId : existing.vendorId,
        bomId: patch.bomId !== undefined ? patch.bomId : existing.bomId,
        sourceBinId:
          patch.sourceBinId !== undefined ? patch.sourceBinId : existing.sourceBinId,
        toWarehouseId:
          patch.toWarehouseId !== undefined ? patch.toWarehouseId : existing.toWarehouseId,
        toBinId: patch.toBinId !== undefined ? patch.toBinId : existing.toBinId,
        tags: patch.tags !== undefined ? patch.tags : existing.tags,
        active: patch.active !== undefined ? patch.active : existing.active,
        notes: patch.notes !== undefined ? patch.notes : existing.notes,
      });
      if (!validateStockRulePayload(merged, reply)) return;
      const data = {
        ...finalizeStockRuleData(merged),
        variantId: merged.variantId ?? null,
      };
      const updated = await db.stockRule.update({
        where: { id },
        data,
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
