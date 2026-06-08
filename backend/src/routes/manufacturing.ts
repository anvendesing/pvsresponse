// Manufacturing module routes.
//
// Covers:
//   * BOM CRUD (single-level definition; multi-level happens at
//     query time via lib/bom.ts walking parent->child Bom links).
//   * BOM tree / explode / where-used.
//   * Production order create, requirements check, issue raw
//     materials, log output, complete (post FG to inventory).
//   * Work-order status updates.
//
// Inventory side-effects (issue + complete) write to StockLedger so
// reports stay consistent. Issuing decrements bin balances; complete
// increments the FG bin (auto-picked: any active bin in the active
// warehouse - the operator can transfer afterwards).
//
// Status transitions for ProductionOrder:
//   planned -> in-progress  (first material issued or first WO started)
//   in-progress -> qc       (operator marks ready for QC, optional)
//   in-progress|qc -> completed (POST /complete; FG posted to stock)
//   * -> delayed            (system flag; not blocking)

import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { db } from "../db.js";
import { recordChange } from "../sync/log.js";
import { bomTree, explodeBom, whereUsed } from "../lib/bom.js";
import { convertUom, normalizeUomCode, UOMS } from "../lib/uom.js";
import { pickBestBin, resolvePutawayDestination } from "../lib/putaway.js";
import { checkStockRules } from "../lib/stock-rules.js";

/** Sum qty already issued to this MO from stock ledger (negative Issue rows). */
const issuedQtyByProduct = async (
  orderNo: string,
  productIds: string[]
): Promise<Map<string, number>> => {
  if (productIds.length === 0) return new Map();
  const rows = await db.stockLedger.groupBy({
    by: ["productId"],
    where: {
      ref: orderNo,
      productId: { in: productIds },
      qty: { lt: 0 },
    },
    _sum: { qty: true },
  });
  return new Map(
    rows.map((r) => [r.productId, Math.abs(Math.round(r._sum.qty ?? 0))])
  );
};

// Normalize the uom field of every BOM item against the UoM master
// and validate that each item's UoM is in the same category as the
// component product's primary UoM. This mirrors Odoo's rule that
// a component qty cannot be expressed in a unit from a different
// category (you can't put 5 metres of "milk" in a 1 kg recipe).
//
// Throws a 400-friendly error on the first violation; otherwise
// returns the items array with .uom rewritten to its canonical code.
type BomItemDraft = {
  productId: string;
  qty: number;
  uom: string;
  scrapPct: number;
};
const validateAndCanonicalizeBomItems = async (
  items: BomItemDraft[]
): Promise<BomItemDraft[]> => {
  if (items.length === 0) return items;
  const productIds = [...new Set(items.map((i) => i.productId))];
  const products = await db.product.findMany({
    where: { id: { in: productIds } },
    select: { id: true, sku: true, uom: true },
  });
  const prodById = new Map(products.map((p) => [p.id, p]));
  // We need the categoryCode for each canonical UoM in the master.
  const allUoms = await db.uom.findMany({
    select: { code: true, categoryId: true, category: { select: { code: true } } },
  });
  const catByCode = new Map(allUoms.map((u) => [u.code, u.category.code]));

  return items.map((it) => {
    const canonical = normalizeUomCode(it.uom);
    if (!canonical) {
      throw Object.assign(
        new Error(
          `Component uom "${it.uom}" is not a recognised unit. Use one of the canonical codes (kg, g, L, mL, m, cm, pc, dozen, ...) or known aliases.`
        ),
        { statusCode: 400, code: "uom_unknown" }
      );
    }
    const prod = prodById.get(it.productId);
    if (!prod) {
      throw Object.assign(
        new Error(`Component product ${it.productId} not found.`),
        { statusCode: 404, code: "component_not_found" }
      );
    }
    const productUomCanonical = normalizeUomCode(prod.uom) ?? prod.uom;
    const itemCat = catByCode.get(canonical);
    const productCat = catByCode.get(productUomCanonical);
    if (itemCat && productCat && itemCat !== productCat) {
      throw Object.assign(
        new Error(
          `Component ${prod.sku} is measured in ${productUomCanonical} (${productCat}) but the BOM line uses ${canonical} (${itemCat}). Use a unit from the same category.`
        ),
        { statusCode: 400, code: "uom_category_mismatch" }
      );
    }
    return { ...it, uom: canonical };
  });
};

type BomByproductDraft = {
  productId: string;
  variantId: string | null;
  qty: number;
  uom: string;
  costShare: number;
};

const validateAndCanonicalizeBomByproducts = async (
  byproducts: BomByproductDraft[],
  parentProductId: string
): Promise<BomByproductDraft[]> => {
  if (byproducts.length === 0) return byproducts;
  const costTotal = byproducts.reduce((s, b) => s + b.costShare, 0);
  if (costTotal > 100.0001) {
    throw Object.assign(
      new Error(`Total cost share for released components is ${costTotal}% (max 100%).`),
      { statusCode: 400, code: "cost_share_exceeded" }
    );
  }
  const productIds = [...new Set(byproducts.map((b) => b.productId))];
  const products = await db.product.findMany({
    where: { id: { in: productIds } },
    select: { id: true, sku: true, uom: true },
  });
  const prodById = new Map(products.map((p) => [p.id, p]));
  const allUoms = await db.uom.findMany({
    select: { code: true, categoryId: true, category: { select: { code: true } } },
  });
  const catByCode = new Map(allUoms.map((u) => [u.code, u.category.code]));

  const out: BomByproductDraft[] = [];
  for (const bp of byproducts) {
    if (bp.productId === parentProductId) {
      throw Object.assign(
        new Error(
          "The main finished product cannot also be a released by-product on the same BOM."
        ),
        { statusCode: 400, code: "byproduct_same_as_parent" }
      );
    }
    const canonical = normalizeUomCode(bp.uom);
    if (!canonical) {
      throw Object.assign(
        new Error(`Released component uom "${bp.uom}" is not a recognised unit.`),
        { statusCode: 400, code: "uom_unknown" }
      );
    }
    const prod = prodById.get(bp.productId);
    if (!prod) {
      throw Object.assign(
        new Error(`Released product ${bp.productId} not found.`),
        { statusCode: 404, code: "byproduct_not_found" }
      );
    }
    if (bp.variantId) {
      const variant = await db.productVariant.findUnique({
        where: { id: bp.variantId },
        select: { productId: true },
      });
      if (!variant) {
        throw Object.assign(new Error("Released variant not found."), {
          statusCode: 404,
          code: "variant_not_found",
        });
      }
      if (variant.productId !== bp.productId) {
        throw Object.assign(
          new Error("Released variant does not belong to the released product."),
          { statusCode: 400, code: "variant_product_mismatch" }
        );
      }
    }
    const productUomCanonical = normalizeUomCode(prod.uom) ?? prod.uom;
    const itemCat = catByCode.get(canonical);
    const productCat = catByCode.get(productUomCanonical);
    if (itemCat && productCat && itemCat !== productCat) {
      throw Object.assign(
        new Error(
          `Released product ${prod.sku} uses ${productUomCanonical} (${productCat}) but the line uses ${canonical} (${itemCat}).`
        ),
        { statusCode: 400, code: "uom_category_mismatch" }
      );
    }
    out.push({
      ...bp,
      uom: canonical,
      variantId: bp.variantId ?? null,
    });
  }
  return out;
};

const bomDetailInclude = {
  product: { select: { id: true, sku: true, name: true, type: true, uom: true } },
  variant: { select: { id: true, sku: true, size: true } },
  defaultWorkCenter: { select: { id: true, code: true, name: true } },
  defaultMachine: { select: { id: true, code: true, name: true } },
  items: {
    include: {
      product: {
        select: { id: true, sku: true, name: true, uom: true, type: true },
      },
    },
  },
  byproducts: {
    include: {
      product: {
        select: { id: true, sku: true, name: true, uom: true, type: true },
      },
      variant: { select: { id: true, sku: true, size: true } },
    },
  },
} as const;

// ----------------------------------------------------------------
// Schemas

const bomItemInput = z.object({
  productId: z.string().min(1),
  qty: z.number().positive(),
  uom: z.string().min(1).max(20),
  scrapPct: z.number().min(0).max(100).default(0),
});

const bomByproductInput = z.object({
  productId: z.string().min(1),
  variantId: z.string().min(1).nullable().optional(),
  qty: z.number().positive(),
  uom: z.string().min(1).max(20),
  costShare: z.number().min(0).max(100).default(0),
});

const bomCreate = z.object({
  productId: z.string().min(1),
  // Optional variantId - when set, this BOM applies only to that
  // specific variant of `productId`. When null/omitted, it's the
  // product-level default used for any variant without its own BOM.
  variantId: z.string().min(1).nullable().optional(),
  revision: z.string().min(1).max(40).default("Rev-1.0"),
  outputQty: z.number().positive().default(1),
  active: z.boolean().default(true),
  // Optional defaults for production scheduling. Both nullable: a
  // BOM may have neither, just a work center, or a work center +
  // a specific machine on that center.
  defaultWorkCenterId: z.string().min(1).nullable().optional(),
  defaultMachineId: z.string().min(1).nullable().optional(),
  items: z.array(bomItemInput).default([]),
  byproducts: z.array(bomByproductInput).default([]),
});

const bomUpdate = z.object({
  revision: z.string().min(1).max(40).optional(),
  outputQty: z.number().positive().optional(),
  active: z.boolean().optional(),
  defaultWorkCenterId: z.string().min(1).nullable().optional(),
  defaultMachineId: z.string().min(1).nullable().optional(),
  // Replace-all semantics: if items is provided, replace the entire
  // component list. Omit items to leave them untouched.
  items: z.array(bomItemInput).optional(),
  byproducts: z.array(bomByproductInput).optional(),
  // variantId is intentionally NOT updateable here - cloning to a
  // different variant must go through POST /boms/:id/clone so the
  // copy keeps its own audit trail and you can tweak items freely
  // without touching the original.
});

// Validate that, if both default work center and machine are provided,
// the machine actually belongs to that work center. Throws a 400-style
// error so the BOM editor surfaces the mismatch instead of silently
// linking a machine on a different line. Reused by POST /boms and
// PATCH /boms/:id.
const validateBomDefaults = async (
  defaultWorkCenterId: string | null | undefined,
  defaultMachineId: string | null | undefined
): Promise<void> => {
  if (defaultWorkCenterId) {
    const wc = await db.workCenter.findUnique({
      where: { id: defaultWorkCenterId },
    });
    if (!wc) {
      throw Object.assign(new Error("Default work center not found."), {
        statusCode: 404,
        code: "default_work_center_not_found",
      });
    }
  }
  if (defaultMachineId) {
    const m = await db.machine.findUnique({
      where: { id: defaultMachineId },
      select: { workCenterId: true },
    });
    if (!m) {
      throw Object.assign(new Error("Default machine not found."), {
        statusCode: 404,
        code: "default_machine_not_found",
      });
    }
    if (defaultWorkCenterId && m.workCenterId !== defaultWorkCenterId) {
      throw Object.assign(
        new Error(
          "Default machine does not belong to the chosen work center."
        ),
        {
          statusCode: 400,
          code: "machine_workcenter_mismatch",
        }
      );
    }
  }
};

const bomClone = z.object({
  // Where to send the clone:
  //   * variantId set     - clone to a specific variant of the same product
  //   * variantId null    - clone to product-level default
  //   * variantId omitted - clone with same variant scope as source
  //                         (use this when you just want a new revision)
  variantId: z.string().min(1).nullable().optional(),
  // Optional revision label. If omitted we auto-bump (Rev-1.0 ->
  // Rev-1.1; anything not parseable becomes "<source>-clone").
  revision: z.string().min(1).max(40).optional(),
  // If true (default), set the new BOM active and deactivate any
  // existing active BOM for the same (product, variant) pair so
  // explode picks the freshest one. If false, the clone is created
  // inactive (draft).
  setActive: z.boolean().default(true),
});

const moCreate = z.object({
  bomId: z.string(),
  // Free-text fields kept for backwards compatibility. When omitted,
  // we resolve them from the BOM's defaultWorkCenter / defaultMachine
  // master refs (if set), so the operator never has to retype the
  // station that was already configured on the BOM.
  station: z.string().optional(),
  machine: z.string().optional(),
  plannedQty: z.number().positive(),
  startDate: z.string(),
  dueDate: z.string(),
});

const woUpdate = z.object({
  status: z.enum(["queued", "running", "paused", "complete"]).optional(),
  output: z.number().optional(),
});

const issueMaterials = z.object({
  warehouseId: z.string().optional(),
  // If true (default), short-issues are still allowed; the issued qty
  // never exceeds bin availability. If false, throw 409 when any line
  // is short.
  allowShort: z.boolean().default(true),
});

const logOutput = z.object({
  goodQty: z.number().nonnegative().default(0),
  scrapQty: z.number().nonnegative().default(0),
  reworkQty: z.number().nonnegative().default(0),
  // Optional per-batch byproduct yields. Each entry refers to a row
  // on the MO's BOM byproduct list and posts the qty to inventory
  // immediately (StockLedger + Bin). Once any byproduct is logged
  // manually here, the auto-yield path on /complete is skipped so we
  // never double-post.
  byproducts: z
    .array(
      z.object({
        bomByproductId: z.string().min(1),
        qty: z.number().nonnegative(),
      })
    )
    .default([]),
});

// Correction endpoint: SET the running totals to absolute values
// (instead of adding to them like log-output does). Used when an
// operator wrong-logged a batch (e.g. clicked "Log output" twice
// and recorded 90 instead of the real 40). Optional `reason` is
// stored as a freeform note in the change log so the audit trail
// captures the why.
const adjustOutput = z.object({
  actualQty: z.number().nonnegative(),
  scrapQty: z.number().nonnegative(),
  reworkQty: z.number().nonnegative(),
  reason: z.string().max(240).optional(),
});

const completeMo = z.object({
  // Where to post the finished goods. Defaults to the work center's
  // production-line warehouse, then any active warehouse.
  warehouseId: z.string().optional(),
  // Optional final qty truth-up (else uses the existing actualQty).
  finalGoodQty: z.number().nonnegative().optional(),
});

// ----------------------------------------------------------------
// Helpers

const requireWriter = (
  req: { user: { role: string } },
  reply: { code: (n: number) => { send: (b: unknown) => void } }
) => {
  const r = req.user.role;
  if (r !== "admin" && r !== "supervisor" && r !== "warehouse") {
    reply.code(403).send({
      error: { code: "forbidden", message: "Admins/supervisors only" },
    });
    return false;
  }
  return true;
};

// Pick a candidate bin for issuing raw materials.
//
// When strict=true (production-line warehouse mode), ONLY search the
// specified warehouse - no global fallback. When strict=false (legacy
// mode), fall back to any bin in the company that holds the product,
// useful in dev/demo setups where raw stock isn't segregated.
const pickBinForIssue = async (
  warehouseId: string | null,
  productId: string,
  strict = false
) => {
  if (warehouseId) {
    const inWh = await db.bin.findFirst({
      where: { warehouseId, productId, qty: { gt: 0 } },
      orderBy: { qty: "desc" },
    });
    if (inWh) return inWh;
    if (strict) return null; // Never fall back when a production-line warehouse is set.
  }
  return db.bin.findFirst({
    where: { productId, qty: { gt: 0 } },
    orderBy: { qty: "desc" },
  });
};

const pickBinForReceive = async (
  warehouseId: string | null,
  productId: string
) => {
  if (warehouseId) {
    const matching = await db.bin.findFirst({
      where: { warehouseId, productId, qty: { lt: db.bin.fields.capacity } },
      orderBy: { qty: "asc" },
    });
    if (matching) return matching;
    const empty = await db.bin.findFirst({
      where: { warehouseId, productId: null, qty: 0 },
      orderBy: [
        { zone: "asc" },
        { shelf: "asc" },
        { bin: "asc" },
      ],
    });
    if (empty) return empty;
  }
  // Fallback: any non-full bin with this product anywhere, then any
  // empty bin anywhere.
  const matchingAny = await db.bin.findFirst({
    where: { productId, qty: { lt: db.bin.fields.capacity } },
    orderBy: { qty: "asc" },
  });
  if (matchingAny) return matchingAny;
  return db.bin.findFirst({
    where: { productId: null, qty: 0 },
    orderBy: [
      { zone: "asc" },
      { shelf: "asc" },
      { bin: "asc" },
    ],
  });
};

// Flip machine.status by free-text name. WorkOrder.machine is a
// free-text label (legacy), so we resolve to the master Machine row
// when the name matches and update its status. No-ops silently when
// the name is "—" or doesn't match anything - keeps callers simple.
//
// Called whenever an MO transitions through state: 'running' on
// material issue (= line is now consuming raw materials) and 'idle'
// on complete. Maintenance / broken statuses are operator-set and
// never overwritten by this helper.
const setMachineStatusByName = async (
  machineName: string | null | undefined,
  next: "running" | "idle"
): Promise<void> => {
  if (!machineName || machineName === "—") return;
  const m = await db.machine.findFirst({
    where: { name: machineName, active: true },
    select: { id: true, status: true },
  });
  if (!m) return;
  if (m.status === "maintenance" || m.status === "broken") return;
  if (m.status === next) return;
  await db.machine.update({ where: { id: m.id }, data: { status: next } });
};

// Sequence helper: next Transfer Order number.
const nextTransferNo = async (): Promise<string> => {
  const year = new Date().getUTCFullYear();
  const prefix = `TRF-${year}-`;
  const last = await db.transferOrder.findFirst({
    where: { transferNo: { startsWith: prefix } },
    orderBy: { transferNo: "desc" },
    select: { transferNo: true },
  });
  const n = last
    ? parseInt(last.transferNo.split("-").pop() ?? "2200", 10) + 1
    : 2201;
  return `${prefix}${String(n).padStart(4, "0")}`;
};

// Sequence helper: next MO/WO number.
const nextMoNo = async (): Promise<string> => {
  const last = await db.productionOrder.findFirst({
    where: { orderNo: { startsWith: "MO-2026-" } },
    orderBy: { orderNo: "desc" },
    select: { orderNo: true },
  });
  const n = last
    ? parseInt(last.orderNo.split("-").pop() ?? "2200", 10) + 1
    : 2201;
  return `MO-2026-${String(n).padStart(4, "0")}`;
};

// ----------------------------------------------------------------
// Routes

export const mfgRoutes = async (app: FastifyInstance) => {
  // ============= Production master data =============
  // Work centers (production lines / cells / departments) and the
  // machines that live on them. Lightweight CRUD - the values are
  // also referenced from BOM / WO free-text "station" / "machine"
  // fields so historical records keep rendering after rename.

  const workCenterCreate = z.object({
    code: z.string().min(1).max(40),
    name: z.string().min(1).max(120),
    description: z.string().nullable().optional(),
    capacityPerHour: z.number().positive().nullable().optional(),
    productionLineWarehouseId: z.string().min(1).nullable().optional(),
    autoCreateProductionWarehouse: z.boolean().optional(),
    active: z.boolean().default(true),
  });
  const workCenterUpdate = workCenterCreate.partial();
  const machineCreate = z.object({
    code: z.string().min(1).max(40),
    name: z.string().min(1).max(120),
    workCenterId: z.string().min(1),
    status: z.enum(["running", "idle", "maintenance", "broken"]).default("idle"),
    description: z.string().nullable().optional(),
    active: z.boolean().default(true),
  });
  const machineUpdate = machineCreate.partial();

  app.get("/work-centers", { preHandler: [app.authenticate] }, async (req) => {
    const q = (req.query as Record<string, string>) ?? {};
    const where: Record<string, unknown> = {};
    if (q.active === "1") where.active = true;
    if (q.active === "0") where.active = false;
    return db.workCenter.findMany({
      where,
      orderBy: { code: "asc" },
      include: {
        machines: { orderBy: { code: "asc" } },
        productionLineWarehouse: { select: { id: true, code: true, name: true, kind: true } },
      },
    });
  });

  // Helper: create and link a dedicated production warehouse for a WC.
  const ensureProductionWarehouse = async (wcId: string, wcCode: string, wcName: string) => {
    const whCode = `WH-PROD-${wcCode.toUpperCase().replace(/[^A-Z0-9]+/g, "-")}`;
    let wh = await db.warehouse.findUnique({ where: { code: whCode } });
    if (!wh) {
      wh = await db.warehouse.create({
        data: {
          code: whCode,
          name: `Production line — ${wcName}`,
          city: "Production",
          kind: "production",
          active: true,
        },
      });
      // Create one default bin.
      await db.bin.create({
        data: {
          warehouseId: wh.id,
          zone: "PROD",
          shelf: "01",
          bin: "01",
          qty: 0,
          reservedQty: 0,
          capacity: 9999,
        },
      });
    }
    await db.workCenter.update({
      where: { id: wcId },
      data: { productionLineWarehouseId: wh.id },
    });
    return wh;
  };

  app.post("/work-centers", { preHandler: [app.authenticate] }, async (req, reply) => {
    if (!requireWriter(req, reply)) return;
    const body = workCenterCreate.parse(req.body);
    const dup = await db.workCenter.findUnique({ where: { code: body.code } });
    if (dup) {
      return reply.code(409).send({
        error: { code: "duplicate_code", message: `Work center "${body.code}" already exists.` },
      });
    }
    const { autoCreateProductionWarehouse, ...rest } = body;
    const created = await db.workCenter.create({ data: rest });
    if (autoCreateProductionWarehouse && !created.productionLineWarehouseId) {
      await ensureProductionWarehouse(created.id, created.code, created.name);
    }
    const finalWc = await db.workCenter.findUnique({
      where: { id: created.id },
      include: {
        machines: { orderBy: { code: "asc" } },
        productionLineWarehouse: { select: { id: true, code: true, name: true, kind: true } },
      },
    });
    await recordChange("WorkCenter", created.id, "insert", finalWc, req.user.sub);
    return finalWc;
  });

  app.patch(
    "/work-centers/:id",
    { preHandler: [app.authenticate] },
    async (req, reply) => {
      if (!requireWriter(req, reply)) return;
      const id = (req.params as { id: string }).id;
      const body = workCenterUpdate.parse(req.body);
      if (body.code) {
        const dup = await db.workCenter.findFirst({
          where: { code: body.code, NOT: { id } },
        });
        if (dup) {
          return reply.code(409).send({ error: { code: "duplicate_code" } });
        }
      }
      const { autoCreateProductionWarehouse, ...rest } = body;
      const updated = await db.workCenter.update({ where: { id }, data: rest });

      if (autoCreateProductionWarehouse && !updated.productionLineWarehouseId) {
        await ensureProductionWarehouse(updated.id, updated.code, updated.name);
      }

      const finalWc = await db.workCenter.findUnique({
        where: { id },
        include: {
          machines: { orderBy: { code: "asc" } },
          productionLineWarehouse: { select: { id: true, code: true, name: true, kind: true } },
        },
      });
      await recordChange("WorkCenter", id, "update", finalWc, req.user.sub);
      return finalWc;
    }
  );

  app.delete(
    "/work-centers/:id",
    { preHandler: [app.authenticate] },
    async (req, reply) => {
      if (!requireWriter(req, reply)) return;
      const id = (req.params as { id: string }).id;
      const machineCount = await db.machine.count({ where: { workCenterId: id } });
      if (machineCount > 0) {
        // Soft-delete to preserve referential integrity for any
        // machines still parked on this center. Operator must move
        // those machines first if a hard delete is desired.
        const updated = await db.workCenter.update({
          where: { id },
          data: { active: false },
        });
        await recordChange("WorkCenter", id, "update", updated, req.user.sub);
        return reply.send({
          softDeleted: true,
          message: `Work center has ${machineCount} machine${machineCount === 1 ? "" : "s"} - marked inactive instead of deleted.`,
        });
      }
      await db.workCenter.delete({ where: { id } });
      await recordChange("WorkCenter", id, "delete", { id }, req.user.sub);
      return reply.send({ deleted: true });
    }
  );

  app.get("/machines", { preHandler: [app.authenticate] }, async (req) => {
    const q = (req.query as Record<string, string>) ?? {};
    const where: Record<string, unknown> = {};
    if (q.workCenterId) where.workCenterId = q.workCenterId;
    if (q.active === "1") where.active = true;
    if (q.active === "0") where.active = false;
    return db.machine.findMany({
      where,
      orderBy: { code: "asc" },
      include: {
        workCenter: { select: { id: true, code: true, name: true } },
      },
    });
  });

  app.post("/machines", { preHandler: [app.authenticate] }, async (req, reply) => {
    if (!requireWriter(req, reply)) return;
    const body = machineCreate.parse(req.body);
    const dup = await db.machine.findUnique({ where: { code: body.code } });
    if (dup) {
      return reply.code(409).send({
        error: { code: "duplicate_code", message: `Machine "${body.code}" already exists.` },
      });
    }
    const wc = await db.workCenter.findUnique({ where: { id: body.workCenterId } });
    if (!wc) {
      return reply
        .code(404)
        .send({ error: { code: "work_center_not_found" } });
    }
    const created = await db.machine.create({
      data: body,
      include: { workCenter: { select: { id: true, code: true, name: true } } },
    });
    await recordChange("Machine", created.id, "insert", created, req.user.sub);
    return created;
  });

  app.patch(
    "/machines/:id",
    { preHandler: [app.authenticate] },
    async (req, reply) => {
      if (!requireWriter(req, reply)) return;
      const id = (req.params as { id: string }).id;
      const body = machineUpdate.parse(req.body);
      if (body.code) {
        const dup = await db.machine.findFirst({
          where: { code: body.code, NOT: { id } },
        });
        if (dup) return reply.code(409).send({ error: { code: "duplicate_code" } });
      }
      if (body.workCenterId) {
        const wc = await db.workCenter.findUnique({
          where: { id: body.workCenterId },
        });
        if (!wc) return reply.code(404).send({ error: { code: "work_center_not_found" } });
      }
      const updated = await db.machine.update({
        where: { id },
        data: body,
        include: { workCenter: { select: { id: true, code: true, name: true } } },
      });
      await recordChange("Machine", id, "update", updated, req.user.sub);
      return updated;
    }
  );

  app.delete(
    "/machines/:id",
    { preHandler: [app.authenticate] },
    async (req, reply) => {
      if (!requireWriter(req, reply)) return;
      const id = (req.params as { id: string }).id;
      await db.machine.delete({ where: { id } });
      await recordChange("Machine", id, "delete", { id }, req.user.sub);
      return reply.send({ deleted: true });
    }
  );

  // ============= BOMs =============

  app.get("/boms", async (req) => {
    const q = (req.query as Record<string, string>) ?? {};
    const where: Record<string, unknown> = {};
    if (q.productId) where.productId = q.productId;
    if (q.active === "1") where.active = true;
    if (q.active === "0") where.active = false;
    // Variant filtering:
    //   variantId="<id>"  - exact match (variant-specific BOMs only)
    //   variantId="null"  - only product-level BOMs
    //   variantId omitted - all BOMs for the productId filter
    if (q.variantId === "null") where.variantId = null;
    else if (q.variantId) where.variantId = q.variantId;
    return db.bom.findMany({
      where,
      include: {
        product: { select: { id: true, sku: true, name: true, type: true, uom: true } },
        variant: { select: { id: true, sku: true, size: true } },
        defaultWorkCenter: { select: { id: true, code: true, name: true } },
        defaultMachine: { select: { id: true, code: true, name: true } },
        items: {
          include: {
            product: {
              select: { id: true, sku: true, name: true, uom: true, type: true },
            },
          },
        },
        byproducts: {
          include: {
            product: {
              select: { id: true, sku: true, name: true, uom: true, type: true },
            },
            variant: { select: { id: true, sku: true, size: true } },
          },
        },
      },
      orderBy: { createdAt: "desc" },
    });
  });

  app.get("/boms/:id", async (req, reply) => {
    const id = (req.params as { id: string }).id;
    const bom = await db.bom.findUnique({
      where: { id },
      include: bomDetailInclude,
    });
    if (!bom) return reply.code(404).send({ error: { code: "not_found" } });
    return bom;
  });

  // GET /products/:id/variants-with-boms
  // For the BOM editor's variant dropdown - returns every variant of
  // the parent product alongside whether a variant-specific BOM
  // already exists. Used to drive "configure each variant" UX.
  app.get("/products/:id/variants-with-boms", async (req, reply) => {
    const id = (req.params as { id: string }).id;
    const product = await db.product.findUnique({
      where: { id },
      select: { id: true, sku: true, name: true, uom: true },
    });
    if (!product) return reply.code(404).send({ error: { code: "not_found" } });
    const variants = await db.productVariant.findMany({
      where: { productId: id, active: true },
      orderBy: { sku: "asc" },
    });
    const boms = await db.bom.findMany({
      where: { productId: id },
      select: {
        id: true,
        variantId: true,
        revision: true,
        active: true,
        outputQty: true,
        items: { select: { id: true } },
      },
    });
    const productLevel = boms
      .filter((b) => b.variantId === null && b.active)
      .sort((a, b) => b.revision.localeCompare(a.revision))[0];
    return {
      product,
      productLevelBom: productLevel
        ? {
            id: productLevel.id,
            revision: productLevel.revision,
            componentCount: productLevel.items.length,
          }
        : null,
      variants: variants.map((v) => {
        const variantBoms = boms.filter((b) => b.variantId === v.id);
        const active = variantBoms.find((b) => b.active);
        return {
          id: v.id,
          sku: v.sku,
          label: v.size ?? v.sku,
          size: v.size,
          color: v.color,
          activeBom: active
            ? {
                id: active.id,
                revision: active.revision,
                componentCount: active.items.length,
              }
            : null,
          // True when no variant-specific BOM exists - this variant
          // currently inherits from the product-level default.
          inheritsFromProductLevel: !active,
        };
      }),
    };
  });

  // POST /boms - create with optional items, optional variant scope.
  app.post("/boms", { preHandler: [app.authenticate] }, async (req, reply) => {
    if (!requireWriter(req, reply)) return;
    const body = bomCreate.parse(req.body);
    const parent = await db.product.findUnique({ where: { id: body.productId } });
    if (!parent) return reply.code(404).send({ error: { code: "product_not_found" } });
    // If a variant scope is requested, the variant must belong to
    // the parent product - otherwise the BOM would silently apply to
    // nothing (or worse, the wrong product).
    if (body.variantId) {
      const variant = await db.productVariant.findUnique({
        where: { id: body.variantId },
        select: { productId: true },
      });
      if (!variant) {
        return reply.code(404).send({ error: { code: "variant_not_found" } });
      }
      if (variant.productId !== body.productId) {
        return reply.code(400).send({
          error: {
            code: "variant_product_mismatch",
            message: "The variant does not belong to the BOM parent product.",
          },
        });
      }
    }
    for (const it of body.items) {
      if (it.productId === body.productId) {
        // Self-reference is OK for variant-scoped "packaging BOMs"
        // (e.g. variant "BKRC-1KG-01" consuming bulk parent BKRC). It
        // remains rejected for product-level BOMs because that would be
        // a true cycle (product produces itself).
        if (!body.variantId) {
          return reply.code(400).send({
            error: {
              code: "self_reference",
              message:
                "A product cannot be a component of its own product-level BOM. (Variant-scoped BOMs may consume the parent product as a packaging step.)",
            },
          });
        }
      }
    }
    // Canonicalize every component's uom and reject cross-category
    // mismatches before we persist anything.
    let canonicalItems: BomItemDraft[];
    let canonicalByproducts: BomByproductDraft[];
    try {
      canonicalItems = await validateAndCanonicalizeBomItems(body.items);
      canonicalByproducts = await validateAndCanonicalizeBomByproducts(
        body.byproducts.map((b) => ({
          productId: b.productId,
          variantId: b.variantId ?? null,
          qty: b.qty,
          uom: b.uom,
          costShare: b.costShare,
        })),
        body.productId
      );
    } catch (e) {
      const err = e as Error & { statusCode?: number; code?: string };
      return reply.code(err.statusCode ?? 400).send({
        error: { code: err.code ?? "uom_validation_failed", message: err.message },
      });
    }
    // Validate optional defaults (work center / machine) before persist.
    try {
      await validateBomDefaults(body.defaultWorkCenterId, body.defaultMachineId);
    } catch (e) {
      const err = e as Error & { statusCode?: number; code?: string };
      return reply
        .code(err.statusCode ?? 400)
        .send({ error: { code: err.code ?? "validation", message: err.message } });
    }
    // If we're creating a new active BOM and an active one already
    // exists for the same scope, deactivate the old one so explode
    // / requirements always pick a single canonical BOM.
    if (body.active) {
      await db.bom.updateMany({
        where: {
          productId: body.productId,
          variantId: body.variantId ?? null,
          active: true,
        },
        data: { active: false },
      });
    }
    const created = await db.bom.create({
      data: {
        productId: body.productId,
        variantId: body.variantId ?? null,
        revision: body.revision,
        outputQty: body.outputQty,
        active: body.active,
        defaultWorkCenterId: body.defaultWorkCenterId ?? null,
        defaultMachineId: body.defaultMachineId ?? null,
        items: { create: canonicalItems },
        byproducts: {
          create: canonicalByproducts.map((b) => ({
            productId: b.productId,
            variantId: b.variantId,
            qty: b.qty,
            uom: b.uom,
            costShare: b.costShare,
          })),
        },
      },
      include: bomDetailInclude,
    });
    await recordChange("Bom", created.id, "insert", created, req.user.sub);
    return created;
  });

  // POST /products/:id/generate-default-boms
  // For each variant of this product that doesn't already have an
  // active variant-scoped BOM, create a default "packaging BOM":
  //   * variantId        = variant.id
  //   * outputQty        = 1 (one variant unit per batch)
  //   * items[0].productId = the parent product itself
  //   * items[0].qty     = variant.packSize
  //   * items[0].uom     = parent.uom
  //
  // The generated BOM expresses "1 variant unit consumes packSize parent
  // units" using the canonical UoM master, so a variant declared as
  // "1 pc, packSize 1, parent kg" yields a BOM that consumes 1 kg
  // per pack, and a "100 g pouch" variant declared as "1 pc, packSize
  // 0.1, parent kg" yields a BOM that consumes 0.1 kg per pack.
  //
  // Idempotent: variants that already have an active BOM are skipped.
  // Returns the list of created BOMs and the list of skipped variants
  // (so the UI can tell the operator what happened).
  app.post(
    "/products/:id/generate-default-boms",
    { preHandler: [app.authenticate] },
    async (req, reply) => {
      if (!requireWriter(req, reply)) return;
      const productId = (req.params as { id: string }).id;
      const product = await db.product.findUnique({
        where: { id: productId },
        include: { variants: { where: { active: true } } },
      });
      if (!product) {
        return reply.code(404).send({ error: { code: "product_not_found" } });
      }
      if (product.variants.length === 0) {
        return reply.code(400).send({
          error: {
            code: "no_variants",
            message: "Product has no active variants - nothing to generate.",
          },
        });
      }
      const created: Array<{ variantSku: string; bomId: string; consumed: string }> = [];
      const skipped: Array<{ variantSku: string; reason: string }> = [];
      for (const v of product.variants) {
        const existing = await db.bom.findFirst({
          where: { productId, variantId: v.id, active: true },
          select: { id: true },
        });
        if (existing) {
          skipped.push({
            variantSku: v.sku,
            reason: `already has active BOM ${existing.id}`,
          });
          continue;
        }
        const packSize = v.packSize && v.packSize > 0 ? v.packSize : 1;
        const bom = await db.bom.create({
          data: {
            productId,
            variantId: v.id,
            revision: "Rev-1.0 (auto)",
            outputQty: 1,
            active: true,
            items: {
              create: [
                {
                  productId,
                  qty: packSize,
                  uom: product.uom,
                  scrapPct: 0,
                },
              ],
            },
          },
        });
        created.push({
          variantSku: v.sku,
          bomId: bom.id,
          consumed: `${packSize} ${product.uom} of ${product.sku}`,
        });
        await recordChange("Bom", bom.id, "insert", bom, req.user.sub);
      }
      return { productSku: product.sku, created, skipped };
    }
  );

  // POST /boms/:id/clone
  // Common workflows:
  //   * "Make a 5L variant BOM from the 1L one"
  //   * "Branch a new revision (Rev-1.1) from this BOM"
  // Items are copied verbatim; the caller may then PATCH the clone
  // to swap packaging components etc.
  app.post(
    "/boms/:id/clone",
    { preHandler: [app.authenticate] },
    async (req, reply) => {
      if (!requireWriter(req, reply)) return;
      const id = (req.params as { id: string }).id;
      const body = bomClone.parse(req.body ?? {});
      const source = await db.bom.findUnique({
        where: { id },
        include: { items: true, byproducts: true },
      });
      if (!source) return reply.code(404).send({ error: { code: "not_found" } });

      // "variantId omitted" means "same scope as source" - use the
      // source's variantId. Explicit null means "product-level".
      const targetVariantId =
        body.variantId === undefined ? source.variantId : body.variantId;

      if (targetVariantId) {
        const variant = await db.productVariant.findUnique({
          where: { id: targetVariantId },
          select: { productId: true },
        });
        if (!variant) {
          return reply.code(404).send({ error: { code: "variant_not_found" } });
        }
        if (variant.productId !== source.productId) {
          return reply.code(400).send({
            error: { code: "variant_product_mismatch" },
          });
        }
      }

      // Auto-bump revision: "Rev-1.0" -> "Rev-1.1", anything we
      // can't parse becomes "<source>-clone".
      let revision = body.revision;
      if (!revision) {
        const m = /^Rev-(\d+)\.(\d+)$/.exec(source.revision);
        if (m) revision = `Rev-${m[1]}.${parseInt(m[2], 10) + 1}`;
        else revision = `${source.revision}-clone`;
      }

      // If activating this clone, deactivate the existing active BOM
      // for the target scope.
      if (body.setActive) {
        await db.bom.updateMany({
          where: {
            productId: source.productId,
            variantId: targetVariantId,
            active: true,
          },
          data: { active: false },
        });
      }

      const clone = await db.bom.create({
        data: {
          productId: source.productId,
          variantId: targetVariantId,
          revision,
          outputQty: source.outputQty,
          active: body.setActive,
          items: {
            create: source.items.map((it) => ({
              productId: it.productId,
              qty: it.qty,
              uom: it.uom,
              scrapPct: it.scrapPct,
            })),
          },
          byproducts: {
            create: source.byproducts.map((bp) => ({
              productId: bp.productId,
              variantId: bp.variantId,
              qty: bp.qty,
              uom: bp.uom,
              costShare: bp.costShare,
            })),
          },
        },
        include: bomDetailInclude,
      });
      await recordChange("Bom", clone.id, "insert", clone, req.user.sub);
      return clone;
    }
  );

  // PATCH /boms/:id - replace items (atomic) + scalars.
  // variantId / productId are intentionally immutable; cloning to a
  // new scope must go through POST /boms/:id/clone.
  app.patch(
    "/boms/:id",
    { preHandler: [app.authenticate] },
    async (req, reply) => {
      if (!requireWriter(req, reply)) return;
      const id = (req.params as { id: string }).id;
      const body = bomUpdate.parse(req.body);
      const existing = await db.bom.findUnique({ where: { id } });
      if (!existing) return reply.code(404).send({ error: { code: "not_found" } });
      let canonicalItems: BomItemDraft[] | undefined;
      let canonicalByproducts: BomByproductDraft[] | undefined;
      if (body.items) {
        for (const it of body.items) {
          // Same rule as POST /boms: variant-scoped BOMs may consume
          // their own parent product (packaging pattern). Product-level
          // BOMs may not.
          if (it.productId === existing.productId && !existing.variantId) {
            return reply.code(400).send({
              error: { code: "self_reference" },
            });
          }
        }
        try {
          canonicalItems = await validateAndCanonicalizeBomItems(body.items);
        } catch (e) {
          const err = e as Error & { statusCode?: number; code?: string };
          return reply.code(err.statusCode ?? 400).send({
            error: {
              code: err.code ?? "uom_validation_failed",
              message: err.message,
            },
          });
        }
      }
      if (body.byproducts) {
        try {
          canonicalByproducts = await validateAndCanonicalizeBomByproducts(
            body.byproducts.map((b) => ({
              productId: b.productId,
              variantId: b.variantId ?? null,
              qty: b.qty,
              uom: b.uom,
              costShare: b.costShare,
            })),
            existing.productId
          );
        } catch (e) {
          const err = e as Error & { statusCode?: number; code?: string };
          return reply.code(err.statusCode ?? 400).send({
            error: {
              code: err.code ?? "byproduct_validation_failed",
              message: err.message,
            },
          });
        }
      }
      // Validate work-center / machine defaults if either is being
      // changed in this PATCH. Pull the effective values: a field
      // present in the body wins, otherwise fall back to existing.
      if (
        body.defaultWorkCenterId !== undefined ||
        body.defaultMachineId !== undefined
      ) {
        const nextWc =
          body.defaultWorkCenterId !== undefined
            ? body.defaultWorkCenterId
            : existing.defaultWorkCenterId;
        const nextMachine =
          body.defaultMachineId !== undefined
            ? body.defaultMachineId
            : existing.defaultMachineId;
        try {
          await validateBomDefaults(nextWc, nextMachine);
        } catch (e) {
          const err = e as Error & { statusCode?: number; code?: string };
          return reply.code(err.statusCode ?? 400).send({
            error: { code: err.code ?? "validation", message: err.message },
          });
        }
      }
      // Activating this BOM deactivates any other active BOM for the
      // same (product, variant) scope - otherwise explode picks one
      // arbitrarily.
      if (body.active === true && !existing.active) {
        await db.bom.updateMany({
          where: {
            productId: existing.productId,
            variantId: existing.variantId,
            active: true,
            NOT: { id },
          },
          data: { active: false },
        });
      }
      const updated = await db.$transaction(async (tx) => {
        if (canonicalItems) {
          await tx.bomItem.deleteMany({ where: { bomId: id } });
          await tx.bomItem.createMany({
            data: canonicalItems.map((it) => ({ ...it, bomId: id })),
          });
        }
        if (canonicalByproducts) {
          await tx.bomByproduct.deleteMany({ where: { bomId: id } });
          await tx.bomByproduct.createMany({
            data: canonicalByproducts.map((bp) => ({
              bomId: id,
              productId: bp.productId,
              variantId: bp.variantId,
              qty: bp.qty,
              uom: bp.uom,
              costShare: bp.costShare,
            })),
          });
        }
        return tx.bom.update({
          where: { id },
          data: {
            revision: body.revision,
            outputQty: body.outputQty,
            active: body.active,
            ...(body.defaultWorkCenterId !== undefined && {
              defaultWorkCenterId: body.defaultWorkCenterId,
            }),
            ...(body.defaultMachineId !== undefined && {
              defaultMachineId: body.defaultMachineId,
            }),
          },
          include: bomDetailInclude,
        });
      });
      await recordChange("Bom", id, "update", updated, req.user.sub);
      return updated;
    }
  );

  // DELETE /boms/:id - soft (set active=false) when production orders
  // reference it; hard otherwise.
  app.delete(
    "/boms/:id",
    { preHandler: [app.authenticate] },
    async (req, reply) => {
      if (!requireWriter(req, reply)) return;
      const id = (req.params as { id: string }).id;
      const used = await db.productionOrder.count({ where: { bomId: id } });
      if (used > 0) {
        const updated = await db.bom.update({
          where: { id },
          data: { active: false },
        });
        await recordChange("Bom", id, "update", updated, req.user.sub);
        return { softDeleted: true, message: `BOM has ${used} MO(s); deactivated.` };
      }
      const before = await db.bom.findUnique({ where: { id } });
      if (!before) return reply.code(404).send({ error: { code: "not_found" } });
      await db.bomItem.deleteMany({ where: { bomId: id } });
      await db.bom.delete({ where: { id } });
      await recordChange("Bom", id, "delete", before, req.user.sub);
      return { softDeleted: false };
    }
  );

  // GET /boms/:id/tree?qty=N - walks using THIS BOM's variant scope.
  app.get("/boms/:id/tree", async (req, reply) => {
    const id = (req.params as { id: string }).id;
    const qty = Number((req.query as Record<string, string>)?.qty ?? "1");
    const bom = await db.bom.findUnique({ where: { id } });
    if (!bom) return reply.code(404).send({ error: { code: "not_found" } });
    return bomTree(bom.productId, qty, { variantId: bom.variantId });
  });

  // GET /boms/:id/explode?qty=N
  app.get("/boms/:id/explode", async (req, reply) => {
    const id = (req.params as { id: string }).id;
    const qty = Number((req.query as Record<string, string>)?.qty ?? "1");
    const bom = await db.bom.findUnique({ where: { id } });
    if (!bom) return reply.code(404).send({ error: { code: "not_found" } });
    return explodeBom(bom.productId, qty, { variantId: bom.variantId });
  });

  // GET /products/:id/where-used
  app.get("/products/:id/where-used", async (req) => {
    const id = (req.params as { id: string }).id;
    return whereUsed(id);
  });

  // ============= Production Orders =============

  app.get("/production-orders", async (req) => {
    const q = (req.query as Record<string, string>) ?? {};
    return db.productionOrder.findMany({
      where: { ...(q.status ? { status: q.status } : {}) },
      include: {
        bom: { include: { product: { select: { sku: true, name: true } } } },
        workOrders: true,
      },
      orderBy: { startDate: "desc" },
    });
  });

  app.get("/production-orders/:id", async (req, reply) => {
    const id = (req.params as { id: string }).id;
    const po = await db.productionOrder.findUnique({
      where: { id },
      include: {
        bom: {
          include: {
            product: { select: { id: true, sku: true, name: true, uom: true } },
            items: {
              include: {
                product: {
                  select: {
                    id: true,
                    sku: true,
                    name: true,
                    uom: true,
                    type: true,
                  },
                },
              },
            },
          },
        },
        workOrders: { orderBy: { workOrderNo: "asc" } },
      },
    });
    if (!po) return reply.code(404).send({ error: { code: "not_found" } });
    return po;
  });

  // GET /production-orders/:id/requirements
  // Returns the multi-level explosion + on-hand totals, so the UI can
  // flag shortages before issuing materials.
  app.get(
    "/production-orders/:id/requirements",
    { preHandler: [app.authenticate] },
    async (req, reply) => {
      const id = (req.params as { id: string }).id;
      const po = await db.productionOrder.findUnique({
        where: { id },
        include: { bom: true },
      });
      if (!po) return reply.code(404).send({ error: { code: "not_found" } });
      const remaining = Math.max(0, po.plannedQty - po.actualQty);
      const planQty = remaining > 0 ? remaining : po.plannedQty;
      const leaves = await explodeBom(po.bom.productId, planQty, {
        variantId: po.bom.variantId,
      });
      // On-hand: sum of all bin qty per leaf product (across all bins
      // we own). Reserved qty is excluded.
      const productIds = leaves.map((l) => l.productId);
      const stock = await db.bin.groupBy({
        by: ["productId"],
        where: { productId: { in: productIds } },
        _sum: { qty: true, reservedQty: true },
      });
      const stockMap = new Map(
        stock.map((s) => [
          s.productId,
          {
            onHand: s._sum.qty ?? 0,
            reserved: s._sum.reservedQty ?? 0,
          },
        ])
      );
      const issuedMap = await issuedQtyByProduct(po.orderNo, productIds);
      const lines = leaves.map((l) => {
        const s = stockMap.get(l.productId) ?? { onHand: 0, reserved: 0 };
        const free = s.onHand - s.reserved;
        const required = Math.ceil(l.qty);
        const issued = issuedMap.get(l.productId) ?? 0;
        const stillNeeded = Math.max(0, required - issued);
        return {
          productId: l.productId,
          sku: l.sku,
          name: l.name,
          uom: l.uom,
          path: l.path,
          required,
          issued,
          stillNeeded,
          onHand: s.onHand,
          free,
          // Shortage = additional stock needed in bins to finish issuing.
          // After issue, material left the bins — do not treat that as a shortage.
          shortage: Math.max(0, stillNeeded - free),
        };
      });
      const allFullyIssued = lines.every((l) => l.stillNeeded <= 0);
      const materialsIssued =
        po.status !== "planned" || lines.some((l) => l.issued > 0);
      return {
        productionOrderId: po.id,
        plannedFor: planQty,
        orderNo: po.orderNo,
        status: po.status,
        lines,
        anyShortage: lines.some((l) => l.shortage > 0),
        allFullyIssued,
        materialsIssued,
      };
    }
  );

  // GET /production-orders/:id/inventory-trail
  // Summarises bin/warehouse locations for material issue and FG receipt
  // (stock ledger ref = orderNo) plus linked transfer orders.
  app.get(
    "/production-orders/:id/inventory-trail",
    { preHandler: [app.authenticate] },
    async (req, reply) => {
      const id = (req.params as { id: string }).id;
      const po = await db.productionOrder.findUnique({
        where: { id },
        include: {
          bom: {
            include: {
              product: { select: { id: true, sku: true, name: true, uom: true } },
              // Pull the variant when the BOM is variant-scoped (e.g.
              // a packaging BOM that turns bulk CAOL into 250ml CAOL
              // bottles). Used to label the finished-goods card with
              // the actual variant SKU and uom rather than the parent.
              variant: {
                select: { id: true, sku: true, size: true, uom: true, packSize: true },
              },
              byproducts: { select: { productId: true, variantId: true } },
              defaultWorkCenter: {
                include: {
                  productionLineWarehouse: {
                    select: { id: true, code: true, name: true, kind: true },
                  },
                },
              },
            },
          },
        },
      });
      if (!po) return reply.code(404).send({ error: { code: "not_found" } });

      const plWh = po.bom.defaultWorkCenter?.productionLineWarehouse ?? null;
      const fgProductId = po.bom.productId;
      const fgVariantId = po.bom.variantId;
      // For the byproduct check, key on (productId|variantId) because
      // a single product can serve as a byproduct of multiple BOMs at
      // different variant levels.
      const byproductKeys = new Set(
        po.bom.byproducts.map((b) => `${b.productId}|${b.variantId ?? ""}`)
      );

      const ledger = await db.stockLedger.findMany({
        where: { ref: po.orderNo },
        include: {
          product: { select: { id: true, sku: true, name: true, uom: true } },
          // Variant link is the whole point of this fix — pulling
          // sku/size/uom lets the trail UI show "CAOL-AMU-250ML-05"
          // for a variant-scoped MO instead of the bare parent SKU.
          variant: {
            select: { id: true, sku: true, size: true, uom: true, packSize: true },
          },
          warehouse: { select: { code: true, name: true, kind: true } },
        },
        orderBy: { date: "asc" },
      });

      const isConsumption = (txnType: string, qty: number) =>
        qty < 0 ||
        txnType.toLowerCase() === "issue" ||
        txnType.toLowerCase() === "out";

      type AggRow = {
        productId: string;
        sku: string;
        name: string;
        // Variant tag when the row applies to a sellable variant
        // (e.g. packaging BOM output, variant byproduct). Null for
        // parent / bulk rows.
        variantId: string | null;
        variantSku: string | null;
        variantSize: string | null;
        variantUom: string | null;
        variantPackSize: number | null;
        warehouseCode: string;
        warehouseName: string;
        warehouseKind: string;
        binPath: string;
        qty: number;
        txnTypes: Set<string>;
        lastDate: Date;
      };
      // Key now includes variantId so a parent-bulk consume and a
      // variant-tagged consume of the same product don't collide.
      const aggKey = (
        productId: string,
        variantId: string | null,
        warehouseId: string,
        binPath: string
      ) => `${productId}|${variantId ?? ""}|${warehouseId}|${binPath}`;

      const materialsMap = new Map<string, AggRow>();
      const finishedMap = new Map<string, AggRow>();
      const byproductsMap = new Map<string, AggRow>();

      for (const row of ledger) {
        const binPath = row.bin?.trim() || "—";
        const key = aggKey(row.productId, row.variantId, row.warehouseId, binPath);
        const bpKey = `${row.productId}|${row.variantId ?? ""}`;
        const isBp =
          byproductKeys.has(bpKey) &&
          !isConsumption(row.txnType, row.qty) &&
          row.qty > 0;
        // Finished-goods test: same parent product AND, when the BOM
        // is variant-scoped, same variant. Without the variant guard
        // a variant-scoped MO that happens to use the parent in some
        // intermediate row would drag that row into the FG card.
        const isFg =
          row.productId === fgProductId &&
          (fgVariantId ? row.variantId === fgVariantId : true) &&
          !isConsumption(row.txnType, row.qty);
        const target = isBp
          ? byproductsMap
          : isFg
            ? finishedMap
            : isConsumption(row.txnType, row.qty)
              ? materialsMap
              : row.productId === fgProductId
                ? finishedMap
                : null;
        if (!target) continue;
        const qtyAbs = Math.abs(Math.round(row.qty));
        const existing = target.get(key);
        if (existing) {
          existing.qty += qtyAbs;
          existing.txnTypes.add(row.txnType);
          if (row.date > existing.lastDate) existing.lastDate = row.date;
        } else {
          target.set(key, {
            productId: row.productId,
            sku: row.product.sku,
            name: row.product.name,
            variantId: row.variantId ?? null,
            variantSku: row.variant?.sku ?? null,
            variantSize: row.variant?.size ?? null,
            variantUom: row.variant?.uom ?? null,
            variantPackSize: row.variant?.packSize ?? null,
            warehouseCode: row.warehouse.code,
            warehouseName: row.warehouse.name,
            warehouseKind: row.warehouse.kind,
            binPath,
            qty: qtyAbs,
            txnTypes: new Set([row.txnType]),
            lastDate: row.date,
          });
        }
      }

      const toRows = (m: Map<string, AggRow>) =>
        [...m.values()]
          .map((r) => ({
            productId: r.productId,
            sku: r.sku,
            name: r.name,
            variantId: r.variantId,
            variantSku: r.variantSku,
            variantSize: r.variantSize,
            variantUom: r.variantUom,
            variantPackSize: r.variantPackSize,
            warehouseCode: r.warehouseCode,
            warehouseName: r.warehouseName,
            warehouseKind: r.warehouseKind,
            binPath: r.binPath,
            qty: r.qty,
            txnTypes: [...r.txnTypes],
            lastDate: r.lastDate.toISOString(),
          }))
          .sort(
            (a, b) =>
              (a.variantSku ?? a.sku).localeCompare(b.variantSku ?? b.sku) ||
              a.binPath.localeCompare(b.binPath)
          );

      const transfers = await db.transferOrder.findMany({
        where: { productionOrderId: id },
        include: {
          fromWarehouse: { select: { code: true, name: true } },
          toWarehouse: { select: { code: true, name: true } },
          items: {
            include: {
              product: { select: { sku: true, name: true } },
              fromBin: { select: { zone: true, shelf: true, bin: true } },
              tobin: { select: { zone: true, shelf: true, bin: true } },
            },
          },
        },
        orderBy: { createdAt: "asc" },
      });

      const binLabel = (b: { zone: string; shelf: string; bin: string } | null) =>
        b ? `${b.zone}/${b.shelf}/${b.bin}` : null;

      return {
        productionOrderId: po.id,
        orderNo: po.orderNo,
        status: po.status,
        finishedGood: {
          productId: po.bom.product.id,
          sku: po.bom.product.sku,
          name: po.bom.product.name,
          // For variant-scoped BOMs the FG ledger qty is in variant
          // units (pieces), not the parent's bulk uom — return both
          // so the UI can label "+N {variantUom}" correctly.
          uom: po.bom.variant?.uom ?? po.bom.product.uom,
          parentUom: po.bom.product.uom,
          variantId: po.bom.variant?.id ?? null,
          variantSku: po.bom.variant?.sku ?? null,
          variantSize: po.bom.variant?.size ?? null,
          variantUom: po.bom.variant?.uom ?? null,
          variantPackSize: po.bom.variant?.packSize ?? null,
        },
        productionLineWarehouse: plWh
          ? { code: plWh.code, name: plWh.name, kind: plWh.kind }
          : null,
        materialsConsumed: toRows(materialsMap),
        finishedGoodsPosted: toRows(finishedMap),
        byproductsReleased: toRows(byproductsMap),
        transfers: transfers.map((t) => ({
          id: t.id,
          transferNo: t.transferNo,
          kind: t.kind,
          status: t.status,
          fromWarehouseCode: t.fromWarehouse.code,
          fromWarehouseName: t.fromWarehouse.name,
          toWarehouseCode: t.toWarehouse.code,
          toWarehouseName: t.toWarehouse.name,
          items: t.items.map((i) => ({
            sku: i.product.sku,
            name: i.product.name,
            qtyRequested: i.qtyRequested,
            qtyPicked: i.qtyPicked,
            qtyDropped: i.qtyDropped,
            fromBinPath: binLabel(i.fromBin),
            toBinPath: binLabel(i.tobin),
          })),
        })),
        hasActivity:
          materialsMap.size > 0 ||
          finishedMap.size > 0 ||
          byproductsMap.size > 0 ||
          transfers.length > 0,
      };
    }
  );

  // POST /production-orders
  app.post("/production-orders", { preHandler: [app.authenticate] }, async (req, reply) => {
    if (!requireWriter(req, reply)) return;
    const body = moCreate.parse(req.body);
    const bom = await db.bom.findUnique({
      where: { id: body.bomId },
      include: {
        defaultWorkCenter: { select: { id: true, name: true } },
        defaultMachine: { select: { id: true, name: true } },
      },
    });
    if (!bom) return reply.code(404).send({ error: { code: "bom_not_found" } });
    // Resolve station + machine: caller-supplied values win, otherwise
    // fall back to the BOM's default work center / machine names.
    // Final fallback keeps the legacy "Assembly 1" / "—" placeholders
    // so existing screens that scan the field for non-empty content
    // keep working.
    const station = body.station?.trim()
      || bom.defaultWorkCenter?.name
      || "Assembly 1";
    const machine = body.machine?.trim()
      || bom.defaultMachine?.name
      || "—";
    const orderNo = await nextMoNo();
    const created = await db.productionOrder.create({
      data: {
        orderNo,
        bomId: body.bomId,
        station,
        plannedQty: body.plannedQty,
        startDate: new Date(body.startDate),
        dueDate: new Date(body.dueDate),
      },
    });
    // Auto-create one WorkOrder for the assembly station so the MO has
    // something to track from the start.
    await db.workOrder.create({
      data: {
        workOrderNo: `${orderNo}/1`,
        productionOrderId: created.id,
        station,
        machine,
        workers: "",
        target: body.plannedQty,
      },
    });
    await recordChange("ProductionOrder", created.id, "insert", created, req.user.sub);
    return created;
  });

  // POST /production-orders/:id/release
  // Checks whether the production-line warehouse has enough material
  // for the MO and auto-creates replenishment TransferOrders for any
  // shortages. If the WC has no production-line warehouse, falls back
  // to a plain requirements check (no TOs created).
  app.post(
    "/production-orders/:id/release",
    { preHandler: [app.authenticate] },
    async (req, reply) => {
      if (!requireWriter(req, reply)) return;
      const id = (req.params as { id: string }).id;
      const po = await db.productionOrder.findUnique({
        where: { id },
        include: {
          bom: {
            include: {
              defaultWorkCenter: {
                include: {
                  productionLineWarehouse: { select: { id: true, code: true } },
                },
              },
            },
          },
        },
      });
      if (!po) return reply.code(404).send({ error: { code: "not_found" } });
      if (po.status === "completed") {
        return reply.code(409).send({ error: { code: "already_completed" } });
      }
      if (po.status !== "planned") {
        return reply.code(409).send({
          error: {
            code: "already_released",
            message: `MO ${po.orderNo} is already ${po.status}. Release only applies to planned orders.`,
          },
        });
      }

      const productionLineWhId =
        po.bom.defaultWorkCenter?.productionLineWarehouse?.id ?? null;

      const remaining = Math.max(0, po.plannedQty - po.actualQty);
      const planQty = remaining > 0 ? remaining : po.plannedQty;
      const leaves = await explodeBom(po.bom.productId, planQty, {
        variantId: po.bom.variantId,
      });

      // Calculate on-hand at the production-line warehouse (if set),
      // else fall back to all bins (same as requirements check).
      const productIds = leaves.map((l) => l.productId);
      const stockWhere = productionLineWhId
        ? { productId: { in: productIds }, warehouseId: productionLineWhId }
        : { productId: { in: productIds } };

      const stock = await db.bin.groupBy({
        by: ["productId"],
        where: stockWhere,
        _sum: { qty: true, reservedQty: true },
      });
      const stockMap = new Map(
        stock.map((s) => [
          s.productId,
          {
            onHand: s._sum.qty ?? 0,
            reserved: s._sum.reservedQty ?? 0,
          },
        ])
      );

      const shortages: Array<{
        productId: string;
        sku: string;
        required: number;
        available: number;
        shortage: number;
      }> = [];

      for (const leaf of leaves) {
        const s = stockMap.get(leaf.productId) ?? { onHand: 0, reserved: 0 };
        const free = s.onHand - s.reserved;
        const shortage = Math.max(0, Math.ceil(leaf.qty) - free);
        if (shortage > 0) {
          shortages.push({
            productId: leaf.productId,
            sku: leaf.sku,
            required: Math.ceil(leaf.qty),
            available: free,
            shortage,
          });
        }
      }

      const transferOrderIds: string[] = [];

      // Create replenishment TOs for each shortage when a production-line
      // warehouse is configured. Group all shortages into a single TO
      // pulling from any storage warehouse that has stock.
      if (productionLineWhId && shortages.length > 0) {
        // Find source bins for each shortage from any storage warehouse.
        const toItems: Array<{
          productId: string;
          qtyRequested: number;
          fromBinId: string | null;
        }> = [];

        for (const sh of shortages) {
          const srcBin = await db.bin.findFirst({
            where: {
              productId: sh.productId,
              qty: { gt: 0 },
              warehouse: { kind: "storage", active: true },
            },
            orderBy: { qty: "desc" },
          });
          toItems.push({
            productId: sh.productId,
            qtyRequested: sh.shortage,
            fromBinId: srcBin?.id ?? null,
          });
        }

        // Pick the source warehouse from the first item that has a bin.
        const srcBinWithWh = await (async () => {
          for (const it of toItems) {
            if (it.fromBinId) {
              return db.bin.findUnique({
                where: { id: it.fromBinId },
                select: { warehouseId: true },
              });
            }
          }
          return null;
        })();

        // Use first active storage warehouse as source if no bin found.
        const fromWhId =
          srcBinWithWh?.warehouseId ??
          (
            await db.warehouse.findFirst({
              where: { kind: "storage", active: true },
              select: { id: true },
            })
          )?.id;

        if (fromWhId) {
          const transferNo = await nextTransferNo();
          const toOrder = await db.transferOrder.create({
            data: {
              transferNo,
              kind: "replenishment",
              status: "ready",
              fromWarehouseId: fromWhId,
              toWarehouseId: productionLineWhId,
              productionOrderId: id,
              notes: `Replenishment for MO ${po.orderNo}`,
              items: {
                create: toItems.map((it) => ({
                  productId: it.productId,
                  qtyRequested: it.qtyRequested,
                  fromBinId: it.fromBinId ?? null,
                })),
              },
            },
          });
          transferOrderIds.push(toOrder.id);
          await recordChange("TransferOrder", toOrder.id, "insert", toOrder, req.user.sub);
        }
      }

      // Transition status to in-progress so we know release was triggered.
      if (po.status === "planned") {
        await db.productionOrder.update({
          where: { id },
          data: { status: shortages.length > 0 ? "planned" : "in-progress" },
        });
      }

      return {
        shortages,
        transferOrderIds,
        allMet: shortages.length === 0,
        productionLineWarehouse: productionLineWhId
          ? po.bom.defaultWorkCenter?.productionLineWarehouse
          : null,
      };
    }
  );

  // POST /production-orders/:id/issue-materials
  // Consumes raw materials from inventory based on the multi-level
  // explosion. Writes one StockLedger row per (component, bin) and
  // updates Bin.qty. Status transitions to 'in-progress' on first
  // successful issue.
  app.post(
    "/production-orders/:id/issue-materials",
    { preHandler: [app.authenticate] },
    async (req, reply) => {
      if (!requireWriter(req, reply)) return;
      const id = (req.params as { id: string }).id;
      const body = issueMaterials.parse(req.body ?? {});
      const po = await db.productionOrder.findUnique({
        where: { id },
        include: {
          bom: {
            include: {
              defaultWorkCenter: {
                include: {
                  productionLineWarehouse: { select: { id: true } },
                },
              },
            },
          },
        },
      });
      if (!po) return reply.code(404).send({ error: { code: "not_found" } });
      if (po.status === "completed") {
        return reply
          .code(409)
          .send({ error: { code: "already_completed" } });
      }
      const remaining = Math.max(0, po.plannedQty - po.actualQty);
      const planQty = remaining > 0 ? remaining : po.plannedQty;
      const leaves = await explodeBom(po.bom.productId, planQty, {
        variantId: po.bom.variantId,
      });
      const productIds = leaves.map((l) => l.productId);
      const issuedMap = await issuedQtyByProduct(po.orderNo, productIds);
      const alreadyFullyIssued = leaves.every((l) => {
        const required = Math.ceil(l.qty);
        const issued = issuedMap.get(l.productId) ?? 0;
        return Math.max(0, required - issued) <= 0;
      });
      if (alreadyFullyIssued) {
        return reply.code(409).send({
          error: {
            code: "materials_already_issued",
            message: `MO ${po.orderNo} already has all BOM materials issued.`,
          },
        });
      }

      // When the BOM's work center has a production-line warehouse, issue
      // ONLY from that warehouse. If it doesn't have one, fall back to
      // the operator-specified warehouse (or any warehouse).
      const productionLineWhId =
        po.bom.defaultWorkCenter?.productionLineWarehouse?.id ?? null;

      // Check requireMoReleaseBeforeIssue setting.
      const settings = await db.companyProfile.findFirst({
        where: { key: "default" },
        select: { requireMoReleaseBeforeIssue: true },
      });
      if (settings?.requireMoReleaseBeforeIssue && productionLineWhId) {
        // Verify stock availability at the production-line warehouse.
        const productIds = leaves.map((l) => l.productId);
        const stock = await db.bin.groupBy({
          by: ["productId"],
          where: { productId: { in: productIds }, warehouseId: productionLineWhId },
          _sum: { qty: true, reservedQty: true },
        });
        const stockMap = new Map(
          stock.map((s) => [s.productId, (s._sum.qty ?? 0) - (s._sum.reservedQty ?? 0)])
        );
        const shortages = leaves.filter(
          (l) => (stockMap.get(l.productId) ?? 0) < Math.ceil(l.qty)
        );
        if (shortages.length > 0 && !body.allowShort) {
          return reply.code(409).send({
            error: {
              code: "short_at_production_line",
              message: `${shortages.length} component(s) are short at the production-line warehouse. Run POST /release to create replenishment transfers first.`,
              shortages: shortages.map((l) => ({ sku: l.sku, required: Math.ceil(l.qty), available: stockMap.get(l.productId) ?? 0 })),
            },
          });
        }
      }

      const preferredWhId = productionLineWhId ?? body.warehouseId ?? null;
      if (!productionLineWhId && body.warehouseId) {
        const wh = await db.warehouse.findUnique({ where: { id: body.warehouseId } });
        if (!wh) {
          return reply
            .code(404)
            .send({ error: { code: "warehouse_not_found" } });
        }
      }

      const issued: Array<{
        productId: string;
        sku: string;
        // Both qtys are in the component's stock UoM (after the BOM
        // explosion converted from BomItem.uom -> product.uom).
        requested: number;
        issued: number;
        uom: string;
      }> = [];
      let anyShort = false;
      const decrementedBinIds = new Set<string>();

      for (const leaf of leaves) {
        // leaf.qty is in leaf.uom (the component's stock UoM). Round up
        // because Bin.qty / stockOnHand are integer columns - we'd rather
        // over-issue by < 1 unit than under-issue and oversell later.
        const requested = Math.ceil(leaf.qty);
        let remainingForLeaf = requested;
        let issuedForLeaf = 0;
        // Drain bins one at a time until satisfied or out. The bin's
        // own warehouseId is recorded in the ledger so reports stay
        // accurate even when the operator-specified warehouse is
        // empty for this component.
        while (remainingForLeaf > 0) {
          const bin = await pickBinForIssue(preferredWhId, leaf.productId, productionLineWhId !== null);
          if (!bin) break;
          const take = Math.min(bin.qty, remainingForLeaf);
          if (take <= 0) break;
          await db.bin.update({
            where: { id: bin.id },
            data: { qty: { decrement: take } },
          });
          decrementedBinIds.add(bin.id);
          await db.stockLedger.create({
            data: {
              productId: leaf.productId,
              // BomItem currently only tracks the parent product, not a
              // specific variant, so leave variantId null on issue rows.
              variantId: null,
              warehouseId: bin.warehouseId,
              bin: `${bin.zone}/${bin.shelf}/${bin.bin}`,
              txnType: "Issue",
              ref: po.orderNo,
              qty: -take,
              balance: bin.qty - take,
              date: new Date(),
            },
          });
          remainingForLeaf -= take;
          issuedForLeaf += take;
        }
        // Keep Product.stockOnHand in sync with the bins. Without this
        // the parent counter drifts further every issue (the cause of
        // the "RAW-COCO-OIL parent=0 / bins=1350" drift the reconcile
        // script flagged earlier).
        if (issuedForLeaf > 0) {
          await db.product.update({
            where: { id: leaf.productId },
            data: { stockOnHand: { decrement: issuedForLeaf } },
          });
        }
        issued.push({
          productId: leaf.productId,
          sku: leaf.sku,
          requested,
          issued: issuedForLeaf,
          uom: leaf.uom,
        });
        if (issuedForLeaf < requested) anyShort = true;
      }

      if (anyShort && !body.allowShort) {
        // Hard refusal - throw to roll back via Prisma. Since we
        // didn't wrap in $transaction, we need to bail the simple way
        // and tell the operator.
        return reply.code(409).send({
          error: {
            code: "short_supply",
            message: "Some components could not be fully issued.",
            issued,
          },
        });
      }

      // Flip status forward.
      const updated = await db.productionOrder.update({
        where: { id },
        data: { status: po.status === "planned" ? "in-progress" : po.status },
      });
      // Mark the machines on this MO's WOs as running so the live
      // production-lines panel reflects what's actually consuming
      // material right now.
      const wos = await db.workOrder.findMany({
        where: { productionOrderId: id },
        select: { machine: true },
      });
      for (const w of wos) {
        await setMachineStatusByName(w.machine, "running");
      }
      await recordChange("ProductionOrder", id, "update", updated, req.user.sub);

      const stockRuleResults = [];
      for (const binId of decrementedBinIds) {
        const part = await checkStockRules(binId, req.user.sub);
        stockRuleResults.push(...part.filter((r) => r.created));
      }

      return { issued, anyShort, productionOrder: updated, stockRuleTriggers: stockRuleResults };
    }
  );

  // POST /production-orders/:id/log-output
  // Adds to the running totals on the MO and on the first running
  // WorkOrder (so the WO progress bar moves too).
  //
  // When `byproducts` is non-empty, each entry posts immediately to
  // inventory (StockLedger + Bin update), mirroring the byproduct
  // logic on /complete. Manual logging here turns OFF the auto-yield
  // path on /complete so we never double-post the same released
  // component.
  app.post(
    "/production-orders/:id/log-output",
    { preHandler: [app.authenticate] },
    async (req, reply) => {
      if (!requireWriter(req, reply)) return;
      const id = (req.params as { id: string }).id;
      const body = logOutput.parse(req.body);
      const po = await db.productionOrder.findUnique({
        where: { id },
        include: {
          bom: {
            include: {
              byproducts: {
                include: {
                  product: {
                    select: { id: true, sku: true, name: true, uom: true },
                  },
                },
              },
              defaultWorkCenter: {
                include: {
                  productionLineWarehouse: { select: { id: true } },
                },
              },
            },
          },
        },
      });
      if (!po) return reply.code(404).send({ error: { code: "not_found" } });
      if (po.status === "completed") {
        return reply.code(409).send({ error: { code: "already_completed" } });
      }

      // Validate every byproduct line maps to a row on this MO's BOM.
      const bpById = new Map(po.bom.byproducts.map((b) => [b.id, b]));
      const bpEntries = body.byproducts.filter((b) => b.qty > 0);
      for (const entry of bpEntries) {
        if (!bpById.has(entry.bomByproductId)) {
          return reply.code(400).send({
            error: {
              code: "byproduct_not_on_bom",
              message: `Byproduct ${entry.bomByproductId} is not on this MO's BOM.`,
            },
          });
        }
      }

      const newActual = po.actualQty + body.goodQty;
      const newScrap = po.scrapQty + body.scrapQty;
      const newRework = po.reworkQty + body.reworkQty;
      const updated = await db.productionOrder.update({
        where: { id },
        data: {
          actualQty: newActual,
          scrapQty: newScrap,
          reworkQty: newRework,
          status: po.status === "planned" ? "in-progress" : po.status,
          efficiency:
            po.plannedQty > 0
              ? Math.round((newActual / po.plannedQty) * 1000) / 10
              : 0,
        },
      });

      // Post each byproduct to inventory, picking a destination bin
      // exactly like /complete does (putaway rule -> production-line
      // warehouse -> any usable bin).
      const productionLineWhId =
        po.bom.defaultWorkCenter?.productionLineWarehouse?.id ?? null;
      const landingWhId = productionLineWhId ?? null;

      const byproductPostings: Array<{
        bomByproductId: string;
        productId: string;
        variantId: string | null;
        sku: string;
        name: string;
        qty: number;
        uom: string;
        bin: string;
      }> = [];

      for (const entry of bpEntries) {
        const bp = bpById.get(entry.bomByproductId)!;
        let stockQty = entry.qty;
        try {
          stockQty = convertUom(entry.qty, bp.uom, bp.product.uom, UOMS);
        } catch {
          stockQty = entry.qty;
        }
        const recvQty = Math.round(stockQty);
        if (recvQty <= 0) continue;

        const bpDest = await resolvePutawayDestination(
          bp.productId,
          bp.variantId,
          landingWhId
        );
        let bpBin = bpDest?.binId
          ? await db.bin.findUnique({ where: { id: bpDest.binId } })
          : null;
        if (!bpBin && bpDest?.warehouseId) {
          bpBin = await pickBestBin(bpDest.warehouseId, bp.productId, {
            allowEmptyBinFallback: !bpDest.fixedBin,
          });
        }
        if (!bpBin) {
          bpBin = await pickBinForReceive(
            bpDest?.warehouseId ?? landingWhId,
            bp.productId
          );
        }
        if (!bpBin) {
          return reply.code(409).send({
            error: {
              code: "no_byproduct_bin",
              message: `No bin available to receive byproduct ${bp.product.sku}. Configure putaway or add bin capacity.`,
            },
          });
        }

        // Byproduct bin gets tagged with variantId when the byproduct
        // is variant-scoped (e.g. lye recovered into a "Recycled NaOH
        // 1kg" variant). Without this, the variant bin is invisible
        // to the variant-aware AdjustStockModal and ATP logic.
        await db.bin.update({
          where: { id: bpBin.id },
          data: {
            qty: { increment: recvQty },
            productId: bpBin.productId ?? bp.productId,
            variantId: bpBin.variantId ?? bp.variantId ?? null,
          },
        });
        await db.stockLedger.create({
          data: {
            productId: bp.productId,
            variantId: bp.variantId,
            warehouseId: bpBin.warehouseId,
            bin: `${bpBin.zone}/${bpBin.shelf}/${bpBin.bin}`,
            txnType: "Production",
            ref: po.orderNo,
            qty: recvQty,
            balance: bpBin.qty + recvQty,
            date: new Date(),
          },
        });
        // Counter routing: variant-scoped byproducts credit the variant
        // counter only; parent-scoped byproducts credit the parent.
        // Crediting BOTH (the previous behaviour) double-counted the
        // qty because the bin only physically received it once.
        if (bp.variantId) {
          await db.productVariant.update({
            where: { id: bp.variantId },
            data: { stockOnHand: { increment: recvQty } },
          });
        } else {
          await db.product.update({
            where: { id: bp.productId },
            data: { stockOnHand: { increment: recvQty } },
          });
        }
        byproductPostings.push({
          bomByproductId: bp.id,
          productId: bp.productId,
          variantId: bp.variantId,
          sku: bp.product.sku,
          name: bp.product.name,
          qty: recvQty,
          uom: bp.product.uom,
          bin: `${bpBin.zone}/${bpBin.shelf}/${bpBin.bin}`,
        });
      }

      // Best-effort: the first non-complete WO advances. Anything more
      // sophisticated is handled when the operator marks WOs directly.
      const wo = await db.workOrder.findFirst({
        where: { productionOrderId: id, status: { not: "complete" } },
        orderBy: { workOrderNo: "asc" },
      });
      if (wo) {
        await db.workOrder.update({
          where: { id: wo.id },
          data: {
            output: wo.output + body.goodQty,
            status: wo.status === "queued" ? "running" : wo.status,
            startTime: wo.startTime ?? new Date(),
          },
        });
      }
      await recordChange("ProductionOrder", id, "update", updated, req.user.sub);
      return { ...updated, byproductPostings };
    }
  );

  // POST /production-orders/:id/adjust-output
  // Correction endpoint for wrong-logged production. Unlike log-output
  // (which ADDS deltas), this OVERWRITES actualQty / scrapQty /
  // reworkQty with the absolute values supplied by the operator.
  // Used when a batch was double-logged or mis-typed.
  //
  // Refuses on completed MOs (FG was already posted to inventory; use
  // a stock adjustment instead). Mirrors the WO output rebase from
  // log-output so the WO progress bar tracks the new actual.
  app.post(
    "/production-orders/:id/adjust-output",
    { preHandler: [app.authenticate] },
    async (req, reply) => {
      if (!requireWriter(req, reply)) return;
      const id = (req.params as { id: string }).id;
      const body = adjustOutput.parse(req.body);
      const po = await db.productionOrder.findUnique({ where: { id } });
      if (!po) return reply.code(404).send({ error: { code: "not_found" } });
      if (po.status === "completed") {
        return reply.code(409).send({
          error: {
            code: "already_completed",
            message:
              "Cannot adjust totals after completion - finished goods are already in inventory.",
          },
        });
      }
      // If nothing actually changed, no-op (avoid noisy audit rows).
      const samePoTotals =
        po.actualQty === body.actualQty &&
        po.scrapQty === body.scrapQty &&
        po.reworkQty === body.reworkQty;
      if (samePoTotals) return po;

      const nextStatus =
        body.actualQty > 0 && po.status === "planned" ? "in-progress" : po.status;

      const updated = await db.productionOrder.update({
        where: { id },
        data: {
          actualQty: body.actualQty,
          scrapQty: body.scrapQty,
          reworkQty: body.reworkQty,
          status: nextStatus,
          efficiency:
            po.plannedQty > 0
              ? Math.round((body.actualQty / po.plannedQty) * 1000) / 10
              : 0,
        },
      });

      // Rebase the first non-complete WO output to the new actual.
      // We only have one WO per MO in the current data model, so this
      // matches the operator's mental model "fix the totals" without
      // distributing the delta.
      const wo = await db.workOrder.findFirst({
        where: { productionOrderId: id, status: { not: "complete" } },
        orderBy: { workOrderNo: "asc" },
      });
      if (wo) {
        await db.workOrder.update({
          where: { id: wo.id },
          data: { output: body.actualQty },
        });
      }

      await recordChange(
        "ProductionOrder",
        id,
        "update",
        {
          ...updated,
          _correction: {
            reason: body.reason ?? null,
            previous: {
              actualQty: po.actualQty,
              scrapQty: po.scrapQty,
              reworkQty: po.reworkQty,
            },
          },
        },
        req.user.sub
      );
      return updated;
    }
  );

  // POST /production-orders/:id/complete
  // Finalises the MO: posts FG to inventory, marks all WOs complete,
  // sets status=completed.
  app.post(
    "/production-orders/:id/complete",
    { preHandler: [app.authenticate] },
    async (req, reply) => {
      if (!requireWriter(req, reply)) return;
      const id = (req.params as { id: string }).id;
      const body = completeMo.parse(req.body ?? {});
      const po = await db.productionOrder.findUnique({
        where: { id },
        include: {
          bom: {
            include: {
              byproducts: {
                include: {
                  product: {
                    select: { id: true, sku: true, name: true, uom: true },
                  },
                },
              },
              defaultWorkCenter: {
                include: {
                  productionLineWarehouse: { select: { id: true, code: true, kind: true } },
                },
              },
            },
          },
        },
      });
      if (!po) return reply.code(404).send({ error: { code: "not_found" } });
      if (po.status === "completed") {
        return reply.code(409).send({ error: { code: "already_completed" } });
      }
      const finalQty = body.finalGoodQty ?? po.actualQty;
      if (finalQty <= 0) {
        return reply.code(400).send({
          error: {
            code: "no_output",
            message: "Log some good output before completing.",
          },
        });
      }

      const productionLineWhId =
        po.bom.defaultWorkCenter?.productionLineWarehouse?.id ?? null;
      const landingWhId = productionLineWhId ?? body.warehouseId ?? null;

      const dest = await resolvePutawayDestination(
        po.bom.productId,
        po.bom.variantId,
        landingWhId
      );

      const directPost =
        !productionLineWhId ||
        !dest ||
        dest.warehouseId === productionLineWhId;

      let receiveBin: {
        id: string;
        warehouseId: string;
        zone: string;
        shelf: string;
        bin: string;
        qty: number;
        productId: string | null;
        variantId: string | null;
      } | null = null;

      if (directPost && dest) {
        if (dest.binId) {
          receiveBin = await db.bin.findUnique({ where: { id: dest.binId } });
        } else if (dest.warehouseId) {
          receiveBin = await pickBestBin(dest.warehouseId, po.bom.productId, {
            allowEmptyBinFallback: !dest.fixedBin,
          });
          if (!receiveBin && dest.fixedBin) {
            return reply.code(409).send({
              error: {
                code: "no_putaway_bin",
                message:
                  "Putaway rule requires a fixed destination bin but none is configured.",
              },
            });
          }
        }
      } else if (productionLineWhId) {
        receiveBin = await pickBinForReceive(productionLineWhId, po.bom.productId);
      }

      if (!receiveBin) {
        receiveBin = await pickBinForReceive(landingWhId, po.bom.productId);
      }

      if (!receiveBin) {
        return reply.code(409).send({
          error: {
            code: "no_receive_bin",
            message:
              "No bin available to receive finished goods. Configure a putaway rule with a destination bin.",
          },
        });
      }

      let putaway: { binId: string; bin: string; qty: number } | null = null;
      // Tag the receive bin with productId AND variantId for
      // variant-scoped BOMs. Without this, an MO that produces a
      // variant (e.g. CAOL-AMU-250ML-05) lands its output in a bin
      // tagged only with the parent SKU, and the AdjustStockModal /
      // splitAcrossBins / ATP all conflate it with bulk parent stock.
      // Existing tags are kept to avoid retroactively re-labeling a
      // bin that already holds something else at the parent level.
      await db.bin.update({
        where: { id: receiveBin.id },
        data: {
          qty: { increment: finalQty },
          productId: receiveBin.productId ?? po.bom.productId,
          variantId: receiveBin.variantId ?? po.bom.variantId ?? null,
        },
      });
      await db.stockLedger.create({
        data: {
          productId: po.bom.productId,
          // Variant-scoped BOMs (e.g. "produce 250ml CAOL variant from
          // bulk CAOL parent") tag the production row with the actual
          // variant so the ledger UI can show the finished SKU and not
          // just the parent SKU shared with the bulk consumed material.
          variantId: po.bom.variantId,
          warehouseId: receiveBin.warehouseId,
          bin: `${receiveBin.zone}/${receiveBin.shelf}/${receiveBin.bin}`,
          txnType: "Production",
          ref: po.orderNo,
          qty: finalQty,
          balance: receiveBin.qty + finalQty,
          date: new Date(),
        },
      });
      putaway = {
        binId: receiveBin.id,
        bin: `${receiveBin.zone}/${receiveBin.shelf}/${receiveBin.bin}`,
        qty: finalQty,
      };

      // Variant-scoped BOMs (packaging): output is sellable variant units
      // (e.g. 50 pc). Bulk parent was already consumed on issue — do not
      // add the piece count to parent.stockOnHand (that caused "50 pc → 50 kg").
      // Product-level BOMs: output is the parent product in parent UoM.
      if (po.bom.variantId) {
        await db.productVariant.update({
          where: { id: po.bom.variantId },
          data: { stockOnHand: { increment: finalQty } },
        });
      } else {
        await db.product.update({
          where: { id: po.bom.productId },
          data: { stockOnHand: { increment: finalQty } },
        });
      }

      const byproductPostings: Array<{
        productId: string;
        variantId: string | null;
        sku: string;
        name: string;
        qty: number;
        uom: string;
        bin: string;
        binId: string;
      }> = [];

      // If the operator has been logging byproducts manually via
      // /log-output, those rows are already in the StockLedger
      // (txnType="Production", ref=orderNo, productId in BOM
      // byproducts). In that case we skip the auto-yield path so we
      // never double-post the same released component.
      const bpProductIds = po.bom.byproducts.map((b) => b.productId);
      const manualByproductCount =
        bpProductIds.length === 0
          ? 0
          : await db.stockLedger.count({
              where: {
                ref: po.orderNo,
                productId: { in: bpProductIds },
                txnType: "Production",
                qty: { gt: 0 },
              },
            });
      const skipAutoByproducts = manualByproductCount > 0;

      for (const bp of skipAutoByproducts ? [] : po.bom.byproducts) {
        const batchQty = (bp.qty / po.bom.outputQty) * finalQty;
        if (batchQty <= 0) continue;
        let stockQty = batchQty;
        try {
          stockQty = convertUom(batchQty, bp.uom, bp.product.uom, UOMS);
        } catch {
          stockQty = batchQty;
        }
        const recvQty = Math.round(stockQty);
        if (recvQty <= 0) continue;

        const bpDest = await resolvePutawayDestination(
          bp.productId,
          bp.variantId,
          landingWhId
        );
        let bpBin = bpDest?.binId
          ? await db.bin.findUnique({ where: { id: bpDest.binId } })
          : null;
        if (!bpBin && bpDest?.warehouseId) {
          bpBin = await pickBestBin(bpDest.warehouseId, bp.productId, {
            allowEmptyBinFallback: !bpDest.fixedBin,
          });
        }
        if (!bpBin) {
          bpBin = await pickBinForReceive(
            bpDest?.warehouseId ?? landingWhId,
            bp.productId
          );
        }
        if (!bpBin) {
          return reply.code(409).send({
            error: {
              code: "no_byproduct_bin",
              message: `No bin available to receive by-product ${bp.product.sku}. Configure putaway or add bin capacity.`,
            },
          });
        }

        await db.bin.update({
          where: { id: bpBin.id },
          data: {
            qty: { increment: recvQty },
            productId: bpBin.productId ?? bp.productId,
            // Tag bin with variantId when the byproduct is variant-scoped.
            // See identical comment above on the main byproduct posting.
            variantId: bpBin.variantId ?? bp.variantId ?? null,
          },
        });
        await db.stockLedger.create({
          data: {
            productId: bp.productId,
            // By-product can also be variant-scoped (e.g. lye recovered
            // into a "Recycled NaOH 1kg" variant).
            variantId: bp.variantId,
            warehouseId: bpBin.warehouseId,
            bin: `${bpBin.zone}/${bpBin.shelf}/${bpBin.bin}`,
            txnType: "Production",
            ref: po.orderNo,
            qty: recvQty,
            balance: bpBin.qty + recvQty,
            date: new Date(),
          },
        });
        // Variant-scoped byproducts credit the variant counter only;
        // parent-scoped credit the parent. Don't double-count.
        if (bp.variantId) {
          await db.productVariant.update({
            where: { id: bp.variantId },
            data: { stockOnHand: { increment: recvQty } },
          });
        } else {
          await db.product.update({
            where: { id: bp.productId },
            data: { stockOnHand: { increment: recvQty } },
          });
        }
        byproductPostings.push({
          productId: bp.productId,
          variantId: bp.variantId,
          sku: bp.product.sku,
          name: bp.product.name,
          qty: recvQty,
          uom: bp.product.uom,
          bin: `${bpBin.zone}/${bpBin.shelf}/${bpBin.bin}`,
          binId: bpBin.id,
        });
      }

      let putawayTransferOrderId: string | null = null;
      if (
        productionLineWhId &&
        dest &&
        dest.warehouseId !== productionLineWhId &&
        receiveBin.warehouseId === productionLineWhId
      ) {
        const transferNo = await nextTransferNo();
        const toOrder = await db.transferOrder.create({
          data: {
            transferNo,
            kind: "putaway",
            status: "ready",
            fromWarehouseId: productionLineWhId,
            toWarehouseId: dest.warehouseId,
            productionOrderId: id,
            notes: `Auto-created on MO ${po.orderNo} completion`,
            items: {
              create: [
                {
                  productId: po.bom.productId,
                  variantId: po.bom.variantId ?? null,
                  qtyRequested: finalQty,
                  fromBinId: receiveBin.id,
                  toBinId: dest.binId ?? null,
                },
              ],
            },
          },
        });
        putawayTransferOrderId = toOrder.id;
        await recordChange("TransferOrder", toOrder.id, "insert", toOrder, req.user.sub);
      }

      // Close all work orders.
      await db.workOrder.updateMany({
        where: { productionOrderId: id, status: { not: "complete" } },
        data: { status: "complete", endTime: new Date() },
      });
      const updated = await db.productionOrder.update({
        where: { id },
        data: {
          status: "completed",
          actualQty: finalQty,
          efficiency:
            po.plannedQty > 0
              ? Math.round((finalQty / po.plannedQty) * 1000) / 10
              : 0,
        },
      });
      // Release the machines this MO was running on.
      const finishedWos = await db.workOrder.findMany({
        where: { productionOrderId: id },
        select: { machine: true },
      });
      for (const w of finishedWos) {
        if (!w.machine || w.machine === "—") continue;
        const stillBusy = await db.workOrder.findFirst({
          where: {
            machine: w.machine,
            status: { in: ["running", "queued"] },
            productionOrderId: { not: id },
          },
          select: { id: true },
        });
        if (!stillBusy) {
          await setMachineStatusByName(w.machine, "idle");
        }
      }
      await recordChange("ProductionOrder", id, "update", updated, req.user.sub);
      return {
        productionOrder: updated,
        putaway,
        putawayTransferOrderId,
        byproductPostings,
      };
    }
  );

  // PATCH /work-orders/:id - status / output
  app.patch(
    "/work-orders/:id",
    { preHandler: [app.authenticate] },
    async (req, reply) => {
      if (!requireWriter(req, reply)) return;
      const id = (req.params as { id: string }).id;
      const body = woUpdate.parse(req.body);
      const before = await db.workOrder.findUnique({ where: { id } });
      if (!before) return reply.code(404).send({ error: { code: "not_found" } });
      const data: Record<string, unknown> = { ...body };
      if (body.status === "running" && !before.startTime) {
        data.startTime = new Date();
      }
      if (body.status === "complete") {
        data.endTime = new Date();
      }
      const after = await db.workOrder.update({ where: { id }, data });
      await recordChange("WorkOrder", id, "update", after, req.user.sub);
      return after;
    }
  );
};

