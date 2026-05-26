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
import { normalizeUomCode } from "../lib/uom.js";

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

// ----------------------------------------------------------------
// Schemas

const bomItemInput = z.object({
  productId: z.string().min(1),
  qty: z.number().positive(),
  uom: z.string().min(1).max(20),
  scrapPct: z.number().min(0).max(100).default(0),
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
});

const completeMo = z.object({
  // Where to post the finished goods. Defaults to first active
  // warehouse if not specified.
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

// Pick a candidate bin for either issuing (qty > 0) or receiving FG.
//
// Issue: prefer the operator-specified warehouse, then fall back to
// any bin that holds the product anywhere in the company - useful in
// dev / seed setups where raw stock isn't necessarily in the same
// warehouse the operator picked. We always pick the bin with the
// largest free quantity to drain bins efficiently.
//
// Receive: try the specified warehouse first (existing bin holding
// this product, then an empty bin), then fall back to anywhere.
const pickBinForIssue = async (
  warehouseId: string | null,
  productId: string
) => {
  if (warehouseId) {
    const inWh = await db.bin.findFirst({
      where: { warehouseId, productId, qty: { gt: 0 } },
      orderBy: { qty: "desc" },
    });
    if (inWh) return inWh;
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
        { rack: "asc" },
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
      { rack: "asc" },
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
      include: { machines: { orderBy: { code: "asc" } } },
    });
  });

  app.post("/work-centers", { preHandler: [app.authenticate] }, async (req, reply) => {
    if (!requireWriter(req, reply)) return;
    const body = workCenterCreate.parse(req.body);
    const dup = await db.workCenter.findUnique({ where: { code: body.code } });
    if (dup) {
      return reply.code(409).send({
        error: { code: "duplicate_code", message: `Work center "${body.code}" already exists.` },
      });
    }
    const created = await db.workCenter.create({ data: body });
    await recordChange("WorkCenter", created.id, "insert", created, req.user.sub);
    return created;
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
      const updated = await db.workCenter.update({ where: { id }, data: body });
      await recordChange("WorkCenter", id, "update", updated, req.user.sub);
      return updated;
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
      },
      orderBy: { createdAt: "desc" },
    });
  });

  app.get("/boms/:id", async (req, reply) => {
    const id = (req.params as { id: string }).id;
    const bom = await db.bom.findUnique({
      where: { id },
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
      },
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
    try {
      canonicalItems = await validateAndCanonicalizeBomItems(body.items);
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
      },
      include: {
        product: { select: { sku: true, name: true, type: true, uom: true } },
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
      },
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
        include: { items: true },
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
        },
        include: {
          product: { select: { sku: true, name: true, type: true, uom: true } },
          variant: { select: { id: true, sku: true, size: true } },
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
          include: {
            product: {
              select: { sku: true, name: true, type: true, uom: true },
            },
            variant: { select: { id: true, sku: true, size: true } },
            defaultWorkCenter: { select: { id: true, code: true, name: true } },
            defaultMachine: { select: { id: true, code: true, name: true } },
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
      const lines = leaves.map((l) => {
        const s = stockMap.get(l.productId) ?? { onHand: 0, reserved: 0 };
        const free = s.onHand - s.reserved;
        return {
          productId: l.productId,
          sku: l.sku,
          name: l.name,
          uom: l.uom,
          path: l.path,
          required: l.qty,
          onHand: s.onHand,
          free,
          shortage: Math.max(0, l.qty - free),
        };
      });
      return {
        productionOrderId: po.id,
        plannedFor: planQty,
        lines,
        anyShortage: lines.some((l) => l.shortage > 0),
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
        include: { bom: true },
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

      // Operator-specified warehouse is a *preference* - if it has
      // no stock for a given component we fall back to any active
      // warehouse so dev/demo data with stock spread across
      // WH-RAW/WH-MAIN still issues cleanly.
      const preferredWhId = body.warehouseId ?? null;
      if (preferredWhId) {
        const wh = await db.warehouse.findUnique({ where: { id: preferredWhId } });
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
          const bin = await pickBinForIssue(preferredWhId, leaf.productId);
          if (!bin) break;
          const take = Math.min(bin.qty, remainingForLeaf);
          if (take <= 0) break;
          await db.bin.update({
            where: { id: bin.id },
            data: { qty: { decrement: take } },
          });
          await db.stockLedger.create({
            data: {
              productId: leaf.productId,
              warehouseId: bin.warehouseId,
              bin: `${bin.zone}/${bin.rack}/${bin.shelf}/${bin.bin}`,
              txnType: "out",
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

      return { issued, anyShort, productionOrder: updated };
    }
  );

  // POST /production-orders/:id/log-output
  // Adds to the running totals on the MO and on the first running
  // WorkOrder (so the WO progress bar moves too).
  app.post(
    "/production-orders/:id/log-output",
    { preHandler: [app.authenticate] },
    async (req, reply) => {
      if (!requireWriter(req, reply)) return;
      const id = (req.params as { id: string }).id;
      const body = logOutput.parse(req.body);
      const po = await db.productionOrder.findUnique({ where: { id } });
      if (!po) return reply.code(404).send({ error: { code: "not_found" } });
      if (po.status === "completed") {
        return reply.code(409).send({ error: { code: "already_completed" } });
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
        include: { bom: true },
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
      const preferredWhId = body.warehouseId ?? null;
      if (preferredWhId) {
        const wh = await db.warehouse.findUnique({ where: { id: preferredWhId } });
        if (!wh) {
          return reply.code(404).send({ error: { code: "warehouse_not_found" } });
        }
      }
      // Try to put away the FG. If no bin can be auto-assigned (e.g.
      // empty warehouse with no bin layout), we still mark completed
      // and emit a "no_putaway" warning so the operator can transfer
      // it manually.
      let putaway: { binId: string; bin: string; qty: number } | null = null;
      const bin = await pickBinForReceive(preferredWhId, po.bom.productId);
      if (bin) {
        await db.bin.update({
          where: { id: bin.id },
          data: {
            qty: { increment: finalQty },
            productId: bin.productId ?? po.bom.productId,
          },
        });
        await db.stockLedger.create({
          data: {
            productId: po.bom.productId,
            warehouseId: bin.warehouseId,
            bin: `${bin.zone}/${bin.rack}/${bin.shelf}/${bin.bin}`,
            txnType: "in",
            ref: po.orderNo,
            qty: finalQty,
            balance: bin.qty + finalQty,
            date: new Date(),
          },
        });
        putaway = {
          binId: bin.id,
          bin: `${bin.zone}/${bin.rack}/${bin.shelf}/${bin.bin}`,
          qty: finalQty,
        };
      }
      // Keep parent and variant stockOnHand counters in sync with the
      // bin. If the BOM is variant-scoped, the FG belongs to that
      // variant - increment its counter too. We always increment the
      // parent (it represents bulk on-hand across all variants).
      await db.product.update({
        where: { id: po.bom.productId },
        data: { stockOnHand: { increment: finalQty } },
      });
      if (po.bom.variantId) {
        await db.productVariant.update({
          where: { id: po.bom.variantId },
          data: { stockOnHand: { increment: finalQty } },
        });
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
      // Release the machines this MO was running on. We don't release
      // machines that are still busy with another active WO; the
      // status flip checks for that elsewhere via setMachineStatusByName
      // (it only flips if no other running/queued WO is using the
      // machine right now).
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
      return { productionOrder: updated, putaway };
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
