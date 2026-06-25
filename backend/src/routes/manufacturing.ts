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
//   * -> cancelled            (POST /cancel; issues reversed, TOs cancelled)
//   * -> delayed            (system flag; not blocking)

import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { db } from "../db.js";
import { recordChange } from "../sync/log.js";
import { bomTree, explodeMoBom, whereUsed } from "../lib/bom.js";
import { convertUom, normalizeUomCode, UOMS } from "../lib/uom.js";
import { pickBestBin, resolvePutawayDestination } from "../lib/putaway.js";
import { checkStockRules } from "../lib/stock-rules.js";
import { scheduleStockRulesCheck } from "../lib/stock-rules-runner.js";
import { issueMaterialFifo } from "../lib/stock-lots.js";
import {
  completeWorkOrder,
  createWorkOrdersFromBom,
  recordWorkOrderQa,
  splitOperationWorkOrders,
  startWorkOrder,
  assignWorkOrderLineMachine,
  addWorkOrderRun,
  startWorkOrderRun,
  logWorkOrderRun,
  completeWorkOrderRun,
  abandonWorkOrderRun,
  deleteWorkOrderRun,
} from "../lib/mo-work-orders.js";
import { facilityReplenishCodes, findReplenishmentSourceBin } from "../lib/facility-ops.js";
import { generatePackBomsForProduct } from "../lib/generate-pack-boms.js";
import { resolveComponentVariantIdForMoIssue } from "../lib/soap-semi.js";
import {
  cancelProductionOrder,
  MoCancelError,
} from "../lib/mo-cancel.js";

/** UoMs that can only be issued in whole units (pieces, dozen, pack...). */
const UNIT_UOM_CODES = new Set(
  UOMS.filter((u) => u.categoryCode === "unit").map((u) => u.code)
);
const isUnitUom = (uom: string | null | undefined): boolean => {
  if (!uom) return false;
  const normalized = normalizeUomCode(uom) ?? uom;
  return UNIT_UOM_CODES.has(normalized);
};
/**
 * Round a BOM-component qty to a sensible precision. Pieces/dozen/pack
 * can't be issued fractionally so we ceil them; mass / volume / length
 * round to 3 decimals so a 50 g (0.05 kg) requirement stays 0.05 kg
 * rather than getting ceiled to 1 kg.
 */
const roundComponentQty = (qty: number, uom: string | null | undefined): number => {
  if (isUnitUom(uom)) return Math.ceil(qty);
  return Math.round(qty * 1000) / 1000;
};
const round3 = (qty: number) => Math.round(qty * 1000) / 1000;

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
    rows.map((r) => [r.productId, round3(Math.abs(r._sum.qty ?? 0))])
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
  defaultFacility: { select: { id: true, code: true, name: true } },
  defaultLine: { select: { id: true, code: true, name: true } },
  defaultMachine: { select: { id: true, code: true, name: true } },
  operations: {
    orderBy: { seq: "asc" as const },
    include: {
      line: { select: { id: true, code: true, name: true } },
      machine: { select: { id: true, code: true, name: true } },
      facility: { select: { id: true, code: true, name: true } },
      eligibleLines: {
        include: { line: { select: { id: true, code: true, name: true } } },
      },
    },
  },
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

const woInclude = {
  orderBy: { workOrderNo: "asc" as const },
  include: {
    bomOperation: { select: { id: true, seq: true, name: true, requiresQa: true } },
    line: { select: { id: true, code: true, name: true } },
    machineRef: { select: { id: true, code: true, name: true } },
    // Multi-machine parallel runs on a single WO. Empty array means
    // the WO is in legacy single-machine mode (output is the scalar
    // on WorkOrder). When non-empty, WorkOrder.output is the rollup
    // of sum(runs.goodQty).
    runs: {
      orderBy: { createdAt: "asc" as const },
      include: {
        machine: { select: { id: true, code: true, name: true } },
        line: { select: { id: true, code: true, name: true } },
      },
    },
  },
};

// ----------------------------------------------------------------
// Schemas

const bomItemInput = z.object({
  productId: z.string().min(1),
  qty: z.number().positive(),
  uom: z.string().min(1).max(20),
  scrapPct: z.number().min(0).max(100).default(0),
  // Link component to operation by seq (Odoo consume at operation).
  operationSeq: z.number().int().positive().optional(),
});

const bomOperationInput = z.object({
  seq: z.number().int().positive(),
  name: z.string().min(1).max(80),
  description: z.string().max(500).optional(),
  facilityId: z.string().min(1).nullable().optional(),
  lineId: z.string().min(1).nullable().optional(),
  machineId: z.string().min(1).nullable().optional(),
  durationMinutes: z.number().positive().nullable().optional(),
  requiresQa: z.boolean().default(true),
  blockedBySeq: z.number().int().positive().nullable().optional(),
  eligibleLineIds: z.array(z.string().min(1)).optional(),
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
  // New two-level production defaults. Both nullable:
  //   defaultFacilityId — the production facility (e.g. Soap Room) used to
  //                       pre-fill the MO creation modal.
  //   defaultLineId     — optional specific line preference; supervisor can
  //                       override at MO assign time.
  //   defaultMachineId  — optional default machine on the preferred line.
  defaultFacilityId: z.string().min(1).nullable().optional(),
  defaultLineId: z.string().min(1).nullable().optional(),
  defaultMachineId: z.string().min(1).nullable().optional(),
  operationDependencies: z.boolean().default(false),
  operations: z.array(bomOperationInput).default([]),
  items: z.array(bomItemInput).default([]),
  byproducts: z.array(bomByproductInput).default([]),
});

const bomUpdate = z.object({
  revision: z.string().min(1).max(40).optional(),
  outputQty: z.number().positive().optional(),
  active: z.boolean().optional(),
  defaultFacilityId: z.string().min(1).nullable().optional(),
  defaultLineId: z.string().min(1).nullable().optional(),
  defaultMachineId: z.string().min(1).nullable().optional(),
  operationDependencies: z.boolean().optional(),
  operations: z.array(bomOperationInput).optional(),
  // Replace-all semantics: if items is provided, replace the entire
  // component list. Omit items to leave them untouched.
  items: z.array(bomItemInput).optional(),
  byproducts: z.array(bomByproductInput).optional(),
  // variantId is intentionally NOT updateable here - cloning to a
  // different variant must go through POST /boms/:id/clone so the
  // copy keeps its own audit trail and you can tweak items freely
  // without touching the original.
});

// Validate the new two-level BOM defaults (facility → line → machine).
// Enforces: line must belong to facility; machine must belong to line.
// Throws 400-style errors so the BOM editor can surface them.
// Reused by POST /boms and PATCH /boms/:id.
const validateBomDefaults = async (
  defaultFacilityId: string | null | undefined,
  defaultLineId: string | null | undefined,
  defaultMachineId: string | null | undefined
): Promise<void> => {
  if (defaultFacilityId) {
    const fac = await db.productionFacility.findUnique({
      where: { id: defaultFacilityId },
    });
    if (!fac) {
      throw Object.assign(new Error("Default production facility not found."), {
        statusCode: 404,
        code: "default_facility_not_found",
      });
    }
  }
  if (defaultLineId) {
    const line = await db.productionLine.findUnique({
      where: { id: defaultLineId },
      select: { facilityId: true },
    });
    if (!line) {
      throw Object.assign(new Error("Default production line not found."), {
        statusCode: 404,
        code: "default_line_not_found",
      });
    }
    if (defaultFacilityId && line.facilityId !== defaultFacilityId) {
      throw Object.assign(
        new Error("Default production line does not belong to the chosen facility."),
        { statusCode: 400, code: "line_facility_mismatch" }
      );
    }
  }
  if (defaultMachineId) {
    const m = await db.machine.findUnique({
      where: { id: defaultMachineId },
      select: { productionLineId: true },
    });
    if (!m) {
      throw Object.assign(new Error("Default machine not found."), {
        statusCode: 404,
        code: "default_machine_not_found",
      });
    }
    if (defaultLineId && m.productionLineId !== defaultLineId) {
      throw Object.assign(
        new Error("Default machine does not belong to the chosen production line."),
        { statusCode: 400, code: "machine_line_mismatch" }
      );
    }
  }
};

type BomOperationDraft = z.infer<typeof bomOperationInput>;

/** Replace-all BOM operations (Odoo Operations tab). Returns seq → operation id. */
const persistBomOperations = async (
  bomId: string,
  operations: BomOperationDraft[]
): Promise<Map<number, string>> => {
  await db.bomOperationLine.deleteMany({
    where: { bomOperation: { bomId } },
  });
  await db.bomOperation.deleteMany({ where: { bomId } });

  const seqToId = new Map<number, string>();
  const sorted = [...operations].sort((a, b) => a.seq - b.seq);

  for (const op of sorted) {
    const blockedByOperationId = op.blockedBySeq
      ? (seqToId.get(op.blockedBySeq) ?? null)
      : null;
    const row = await db.bomOperation.create({
      data: {
        bomId,
        seq: op.seq,
        name: op.name,
        description: op.description ?? null,
        facilityId: op.facilityId ?? null,
        lineId: op.lineId ?? null,
        machineId: op.machineId ?? null,
        durationMinutes: op.durationMinutes ?? null,
        requiresQa: op.requiresQa,
        blockedByOperationId,
        eligibleLines: op.eligibleLineIds?.length
          ? { create: op.eligibleLineIds.map((lineId) => ({ lineId })) }
          : undefined,
      },
    });
    seqToId.set(op.seq, row.id);
  }
  return seqToId;
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
  // New facility/line FKs. facilityId defaults to BOM.defaultFacilityId.
  // lineId defaults to BOM.defaultLineId and may stay null (supervisor assigns).
  facilityId: z.string().optional(),
  lineId: z.string().optional(),
  // Legacy free-text fields kept for backwards compatibility.
  station: z.string().optional(),
  machine: z.string().optional(),
  plannedQty: z.number().positive(),
  startDate: z.string(),
  dueDate: z.string(),
});

const assignLine = z.object({
  lineId: z.string().min(1),
  workOrderAssignments: z
    .array(
      z.object({
        workOrderId: z.string().min(1),
        lineId: z.string().min(1).optional(),
        machineId: z.string().min(1).nullable().optional(),
      })
    )
    .optional(),
});

const assignWorkOrder = z.object({
  lineId: z.string().min(1).optional(),
  machineId: z.string().min(1).nullable().optional(),
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
  // Operator may complete an MO even if no stock is left for one or
  // more BOM components (Issue logs as much as available). Without
  // this, Complete returns 409 if components can't be fully issued.
  allowShortMaterials: z.boolean().optional(),
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

const pickBinForReceive = async (
  warehouseId: string | null,
  productId: string,
  zone?: string | null,
  variantId?: string | null
) => {
  if (warehouseId) {
    return pickBestBin(warehouseId, productId, {
      allowEmptyBinFallback: true,
      zone: zone ?? undefined,
      variantId: variantId === undefined ? undefined : variantId,
    });
  }
  const level =
    variantId === undefined
      ? {}
      : variantId != null
        ? { variantId }
        : { variantId: null };
  const matchingAny = await db.bin.findFirst({
    where: { productId, qty: { lt: db.bin.fields.capacity }, ...level },
    orderBy: { qty: "asc" },
  });
  if (matchingAny) return matchingAny;
  return db.bin.findFirst({
    where: { productId: null, variantId: null, qty: 0 },
    orderBy: [{ zone: "asc" }, { shelf: "asc" }, { bin: "asc" }],
  });
};

// Set machine status by primary-key ID (preferred for new MOs with machineId FK).
const setMachineStatusById = async (
  machineId: string | null | undefined,
  next: "running" | "idle"
): Promise<void> => {
  if (!machineId) return;
  const m = await db.machine.findUnique({
    where: { id: machineId },
    select: { id: true, status: true },
  });
  if (!m) return;
  if (m.status === "maintenance" || m.status === "broken") return;
  if (m.status === next) return;
  await db.machine.update({ where: { id: m.id }, data: { status: next } });
};

// Flip machine.status by free-text name (legacy path for old WOs that
// still use the WorkOrder.machine text column). No-ops silently when
// the name is "—" or doesn't match anything.
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
  // ProductionFacility (e.g. "Soap Room") contains ProductionLines
  // (e.g. "Boiling Line", "Mixing Line"). Each line owns its Machines.
  // The facility owns a shared production-line warehouse for material
  // staging. Legacy /work-centers routes are aliased for one release.

  const facilityCreate = z.object({
    code: z.string().min(1).max(40),
    name: z.string().min(1).max(120),
    description: z.string().nullable().optional(),
    capacityPerHour: z.number().positive().nullable().optional(),
    productionLineWarehouseId: z.string().min(1).nullable().optional(),
    productionZone: z.string().max(8).nullable().optional(),
    replenishWarehouseCodes: z.string().max(500).nullable().optional(),
    autoCreateProductionWarehouse: z.boolean().optional(),
    active: z.boolean().default(true),
  });
  const facilityUpdate = facilityCreate.partial();

  const productionLineCreate = z.object({
    code: z.string().min(1).max(40),
    name: z.string().min(1).max(120),
    description: z.string().nullable().optional(),
    facilityId: z.string().min(1),
    capacityPerHour: z.number().positive().nullable().optional(),
    active: z.boolean().default(true),
  });
  const productionLineUpdate = productionLineCreate.partial();

  const machineCreate = z.object({
    code: z.string().min(1).max(40),
    name: z.string().min(1).max(120),
    productionLineId: z.string().min(1),
    status: z.enum(["running", "idle", "maintenance", "broken"]).default("idle"),
    description: z.string().nullable().optional(),
    active: z.boolean().default(true),
  });
  const machineUpdate = machineCreate.partial();

  // Facility include helper
  const facilityInclude = {
    lines: {
      orderBy: { code: "asc" as const },
      include: { machines: { orderBy: { code: "asc" as const } } },
    },
    productionLineWarehouse: { select: { id: true, code: true, name: true, kind: true } },
  } as const;

  // Helper: create and link a dedicated production warehouse for a facility.
  const ensureProductionWarehouse = async (facId: string, facCode: string, facName: string) => {
    const whCode = `WH-PROD-${facCode.toUpperCase().replace(/[^A-Z0-9]+/g, "-")}`;
    let wh = await db.warehouse.findUnique({ where: { code: whCode } });
    if (!wh) {
      wh = await db.warehouse.create({
        data: {
          code: whCode,
          name: `Production — ${facName}`,
          city: "Production",
          kind: "production",
          active: true,
        },
      });
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
    await db.productionFacility.update({
      where: { id: facId },
      data: { productionLineWarehouseId: wh.id },
    });
    return wh;
  };

  // ---- Production facilities ----

  const listFacilities = async (req: { query?: unknown }) => {
    const q = (req.query as Record<string, string>) ?? {};
    const where: Record<string, unknown> = {};
    if (q.active === "1") where.active = true;
    if (q.active === "0") where.active = false;
    return db.productionFacility.findMany({
      where,
      orderBy: { code: "asc" },
      include: facilityInclude,
    });
  };

  app.get("/production-facilities", { preHandler: [app.authenticate] }, listFacilities);
  // Legacy alias — kept for one release; prefer /production-facilities in new code.
  app.get("/work-centers", { preHandler: [app.authenticate] }, listFacilities);

  const createFacility = async (req: { body: unknown; user: { sub: string } }, reply: { code: (n: number) => { send: (b: unknown) => unknown }; send: (b: unknown) => unknown }) => {
    const body = facilityCreate.parse(req.body);
    const dup = await db.productionFacility.findUnique({ where: { code: body.code } });
    if (dup) {
      return reply.code(409).send({
        error: { code: "duplicate_code", message: `Facility "${body.code}" already exists.` },
      });
    }
    const { autoCreateProductionWarehouse, ...rest } = body;
    const created = await db.productionFacility.create({ data: rest });
    if (autoCreateProductionWarehouse && !created.productionLineWarehouseId) {
      await ensureProductionWarehouse(created.id, created.code, created.name);
    }
    const final = await db.productionFacility.findUnique({
      where: { id: created.id },
      include: facilityInclude,
    });
    await recordChange("ProductionFacility", created.id, "insert", final, req.user.sub);
    return final;
  };

  app.post("/production-facilities", { preHandler: [app.authenticate] }, async (req, reply) => {
    if (!requireWriter(req, reply)) return;
    return createFacility(req, reply);
  });
  app.post("/work-centers", { preHandler: [app.authenticate] }, async (req, reply) => {
    if (!requireWriter(req, reply)) return;
    return createFacility(req, reply);
  });

  const patchFacility = async (
    req: { params: unknown; body: unknown; user: { sub: string } },
    reply: { code: (n: number) => { send: (b: unknown) => unknown }; send: (b: unknown) => unknown }
  ) => {
    const id = (req.params as { id: string }).id;
    const body = facilityUpdate.parse(req.body);
    if (body.code) {
      const dup = await db.productionFacility.findFirst({
        where: { code: body.code, NOT: { id } },
      });
      if (dup) return reply.code(409).send({ error: { code: "duplicate_code" } });
    }
    const { autoCreateProductionWarehouse, ...rest } = body;
    const updated = await db.productionFacility.update({ where: { id }, data: rest });
    if (autoCreateProductionWarehouse && !updated.productionLineWarehouseId) {
      await ensureProductionWarehouse(updated.id, updated.code, updated.name);
    }
    const final = await db.productionFacility.findUnique({
      where: { id },
      include: facilityInclude,
    });
    await recordChange("ProductionFacility", id, "update", final, req.user.sub);
    return final;
  };

  app.patch("/production-facilities/:id", { preHandler: [app.authenticate] }, async (req, reply) => {
    if (!requireWriter(req, reply)) return;
    return patchFacility(req, reply);
  });
  app.patch("/work-centers/:id", { preHandler: [app.authenticate] }, async (req, reply) => {
    if (!requireWriter(req, reply)) return;
    return patchFacility(req, reply);
  });

  const deleteFacility = async (
    req: { params: unknown; user: { sub: string } },
    reply: { code: (n: number) => { send: (b: unknown) => unknown }; send: (b: unknown) => unknown }
  ) => {
    const id = (req.params as { id: string }).id;
    const lineCount = await db.productionLine.count({ where: { facilityId: id } });
    if (lineCount > 0) {
      const updated = await db.productionFacility.update({
        where: { id },
        data: { active: false },
      });
      await recordChange("ProductionFacility", id, "update", updated, req.user.sub);
      return reply.send({
        softDeleted: true,
        message: `Facility has ${lineCount} line${lineCount === 1 ? "" : "s"} — marked inactive instead of deleted.`,
      });
    }
    await db.productionFacility.delete({ where: { id } });
    await recordChange("ProductionFacility", id, "delete", { id }, req.user.sub);
    return reply.send({ deleted: true });
  };

  app.delete("/production-facilities/:id", { preHandler: [app.authenticate] }, async (req, reply) => {
    if (!requireWriter(req, reply)) return;
    return deleteFacility(req, reply);
  });
  app.delete("/work-centers/:id", { preHandler: [app.authenticate] }, async (req, reply) => {
    if (!requireWriter(req, reply)) return;
    return deleteFacility(req, reply);
  });

  // ---- Production lines ----

  app.get("/production-lines", { preHandler: [app.authenticate] }, async (req) => {
    const q = (req.query as Record<string, string>) ?? {};
    const where: Record<string, unknown> = {};
    if (q.facilityId) where.facilityId = q.facilityId;
    if (q.active === "1") where.active = true;
    if (q.active === "0") where.active = false;
    return db.productionLine.findMany({
      where,
      orderBy: { code: "asc" },
      include: {
        facility: { select: { id: true, code: true, name: true } },
        machines: { orderBy: { code: "asc" } },
      },
    });
  });

  app.post("/production-lines", { preHandler: [app.authenticate] }, async (req, reply) => {
    if (!requireWriter(req, reply)) return;
    const body = productionLineCreate.parse(req.body);
    const dup = await db.productionLine.findUnique({ where: { code: body.code } });
    if (dup) {
      return reply.code(409).send({
        error: { code: "duplicate_code", message: `Production line "${body.code}" already exists.` },
      });
    }
    const facility = await db.productionFacility.findUnique({ where: { id: body.facilityId } });
    if (!facility) {
      return reply.code(404).send({ error: { code: "facility_not_found" } });
    }
    const created = await db.productionLine.create({
      data: body,
      include: {
        facility: { select: { id: true, code: true, name: true } },
        machines: { orderBy: { code: "asc" } },
      },
    });
    await recordChange("ProductionLine", created.id, "insert", created, req.user.sub);
    return created;
  });

  app.patch("/production-lines/:id", { preHandler: [app.authenticate] }, async (req, reply) => {
    if (!requireWriter(req, reply)) return;
    const id = (req.params as { id: string }).id;
    const body = productionLineUpdate.parse(req.body);
    if (body.code) {
      const dup = await db.productionLine.findFirst({ where: { code: body.code, NOT: { id } } });
      if (dup) return reply.code(409).send({ error: { code: "duplicate_code" } });
    }
    if (body.facilityId) {
      const fac = await db.productionFacility.findUnique({ where: { id: body.facilityId } });
      if (!fac) return reply.code(404).send({ error: { code: "facility_not_found" } });
    }
    const updated = await db.productionLine.update({
      where: { id },
      data: body,
      include: {
        facility: { select: { id: true, code: true, name: true } },
        machines: { orderBy: { code: "asc" } },
      },
    });
    await recordChange("ProductionLine", id, "update", updated, req.user.sub);
    return updated;
  });

  app.delete("/production-lines/:id", { preHandler: [app.authenticate] }, async (req, reply) => {
    if (!requireWriter(req, reply)) return;
    const id = (req.params as { id: string }).id;
    const machineCount = await db.machine.count({ where: { productionLineId: id } });
    const moCount = await db.productionOrder.count({ where: { lineId: id } });
    if (machineCount > 0 || moCount > 0) {
      const updated = await db.productionLine.update({
        where: { id },
        data: { active: false },
      });
      await recordChange("ProductionLine", id, "update", updated, req.user.sub);
      return reply.send({
        softDeleted: true,
        message: `Line has ${machineCount} machine(s) / ${moCount} MO(s) — marked inactive instead of deleted.`,
      });
    }
    await db.productionLine.delete({ where: { id } });
    await recordChange("ProductionLine", id, "delete", { id }, req.user.sub);
    return reply.send({ deleted: true });
  });

  // ---- Machines ----

  app.get("/machines", { preHandler: [app.authenticate] }, async (req) => {
    const q = (req.query as Record<string, string>) ?? {};
    const where: Record<string, unknown> = {};
    if (q.productionLineId) where.productionLineId = q.productionLineId;
    if (q.facilityId) {
      // Convenience: filter machines by facility (all lines in facility).
      where.productionLine = { facilityId: q.facilityId };
    }
    if (q.active === "1") where.active = true;
    if (q.active === "0") where.active = false;
    return db.machine.findMany({
      where,
      orderBy: { code: "asc" },
      include: {
        productionLine: {
          select: {
            id: true, code: true, name: true,
            facility: { select: { id: true, code: true, name: true } },
          },
        },
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
    const line = await db.productionLine.findUnique({ where: { id: body.productionLineId } });
    if (!line) {
      return reply.code(404).send({ error: { code: "production_line_not_found" } });
    }
    const created = await db.machine.create({
      data: body,
      include: {
        productionLine: {
          select: {
            id: true, code: true, name: true,
            facility: { select: { id: true, code: true, name: true } },
          },
        },
      },
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
      if (body.productionLineId) {
        const line = await db.productionLine.findUnique({
          where: { id: body.productionLineId },
        });
        if (!line) return reply.code(404).send({ error: { code: "production_line_not_found" } });
      }
      const updated = await db.machine.update({
        where: { id },
        data: body,
        include: {
          productionLine: {
            select: {
              id: true, code: true, name: true,
              facility: { select: { id: true, code: true, name: true } },
            },
          },
        },
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
      include: bomDetailInclude,
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
    // Validate optional defaults (facility → line → machine) before persist.
    try {
      await validateBomDefaults(body.defaultFacilityId, body.defaultLineId, body.defaultMachineId);
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
        defaultFacilityId: body.defaultFacilityId ?? null,
        defaultLineId: body.defaultLineId ?? null,
        defaultMachineId: body.defaultMachineId ?? null,
        operationDependencies: body.operationDependencies,
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
    });
    const seqToOp =
      body.operations.length > 0
        ? await persistBomOperations(created.id, body.operations)
        : new Map<number, string>();
    if (canonicalItems.length > 0) {
      await db.bomItem.createMany({
        data: body.items.map((it, idx) => ({
          bomId: created.id,
          productId: it.productId,
          qty: canonicalItems[idx]!.qty,
          uom: canonicalItems[idx]!.uom,
          scrapPct: it.scrapPct,
          bomOperationId: it.operationSeq
            ? (seqToOp.get(it.operationSeq) ?? null)
            : null,
        })),
      });
    }
    const full = await db.bom.findUnique({
      where: { id: created.id },
      include: bomDetailInclude,
    });
    await recordChange("Bom", created.id, "insert", full, req.user.sub);
    return full;
  });

  // POST /products/:id/generate-default-boms
  // Packaging BOMs: parent bulk → retail variants with category-based
  // line routing (Oil Room fill, manual pack, vacuum pack).
  app.post(
    "/products/:id/generate-default-boms",
    { preHandler: [app.authenticate] },
    async (req, reply) => {
      if (!requireWriter(req, reply)) return;
      const productId = (req.params as { id: string }).id;
      const product = await db.product.findUnique({
        where: { id: productId },
        select: { id: true },
      });
      if (!product) {
        return reply.code(404).send({ error: { code: "product_not_found" } });
      }
      const result = await generatePackBomsForProduct(productId);
      if (!result) {
        return reply.code(404).send({ error: { code: "product_not_found" } });
      }
      if (
        result.created.length === 0 &&
        result.updated.length === 0 &&
        result.skipped.length === 0
      ) {
        return reply.code(400).send({
          error: {
            code: "no_variants",
            message: "Product has no active variants - nothing to generate.",
          },
        });
      }
      for (const c of result.created) {
        await recordChange("Bom", c.bomId, "insert", c, req.user.sub);
      }
      return {
        productSku: result.productSku,
        created: result.created.map((c) => ({
          variantSku: c.variantSku,
          bomId: c.bomId,
          consumed: c.batch,
          line: c.line,
        })),
        updated: result.updated.map((u) => ({
          variantSku: u.variantSku,
          bomId: u.bomId,
          consumed: u.batch,
          line: u.line,
        })),
        skipped: result.skipped,
      };
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
      // Validate facility/line/machine defaults if any are being changed.
      // Pull effective values: body field wins, else fall back to existing.
      if (
        body.defaultFacilityId !== undefined ||
        body.defaultLineId !== undefined ||
        body.defaultMachineId !== undefined
      ) {
        const nextFacility =
          body.defaultFacilityId !== undefined
            ? body.defaultFacilityId
            : existing.defaultFacilityId;
        const nextLine =
          body.defaultLineId !== undefined
            ? body.defaultLineId
            : existing.defaultLineId;
        const nextMachine =
          body.defaultMachineId !== undefined
            ? body.defaultMachineId
            : existing.defaultMachineId;
        try {
          await validateBomDefaults(nextFacility, nextLine, nextMachine);
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
      let seqToOp: Map<number, string> | undefined;
      if (body.operations) {
        seqToOp = await persistBomOperations(id, body.operations);
      }
      const updated = await db.$transaction(async (tx) => {
        if (canonicalItems && body.items) {
          await tx.bomItem.deleteMany({ where: { bomId: id } });
          await tx.bomItem.createMany({
            data: body.items.map((it, idx) => ({
              bomId: id,
              productId: it.productId,
              qty: canonicalItems![idx]!.qty,
              uom: canonicalItems![idx]!.uom,
              scrapPct: it.scrapPct,
              bomOperationId:
                it.operationSeq && seqToOp
                  ? (seqToOp.get(it.operationSeq) ?? null)
                  : null,
            })),
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
            ...(body.defaultFacilityId !== undefined && {
              defaultFacilityId: body.defaultFacilityId,
            }),
            ...(body.defaultLineId !== undefined && {
              defaultLineId: body.defaultLineId,
            }),
            ...(body.defaultMachineId !== undefined && {
              defaultMachineId: body.defaultMachineId,
            }),
            ...(body.operationDependencies !== undefined && {
              operationDependencies: body.operationDependencies,
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

  // GET /boms/:id/explode?qty=N — direct components on this BOM (MO planning).
  app.get("/boms/:id/explode", async (req, reply) => {
    const id = (req.params as { id: string }).id;
    const qty = Number((req.query as Record<string, string>)?.qty ?? "1");
    const bom = await db.bom.findUnique({ where: { id } });
    if (!bom) return reply.code(404).send({ error: { code: "not_found" } });
    return explodeMoBom(id, qty);
  });

  // GET /products/:id/where-used
  app.get("/products/:id/where-used", async (req) => {
    const id = (req.params as { id: string }).id;
    return whereUsed(id);
  });

  // ============= Production Orders =============

  app.get("/production-orders", async (req) => {
    const q = (req.query as Record<string, string>) ?? {};
    const where: Record<string, unknown> = {};
    if (q.status) where.status = q.status;
    if (q.facilityId) where.facilityId = q.facilityId;
    return db.productionOrder.findMany({
      where,
      include: {
        bom: {
          include: {
            product: { select: { sku: true, name: true } },
            variant: {
              select: { id: true, sku: true, size: true, color: true, barcode: true },
            },
          },
        },
        facility: { select: { id: true, code: true, name: true } },
        line: { select: { id: true, code: true, name: true } },
        workOrders: woInclude,
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
            variant: {
              select: { id: true, sku: true, size: true, color: true, barcode: true },
            },
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
        facility: { select: { id: true, code: true, name: true } },
        line: { select: { id: true, code: true, name: true } },
        workOrders: woInclude,
      },
    });
    if (!po) return reply.code(404).send({ error: { code: "not_found" } });
    return po;
  });

  // GET /production-orders/:id/requirements
  // Returns direct BOM components + on-hand totals for this MO's BOM.
  app.get(
    "/production-orders/:id/requirements",
    { preHandler: [app.authenticate] },
    async (req, reply) => {
      const id = (req.params as { id: string }).id;
      const po = await db.productionOrder.findUnique({
        where: { id },
        include: {
          bom: { select: { id: true } },
          facility: { select: { productionLineWarehouseId: true } },
        },
      });
      if (!po) return reply.code(404).send({ error: { code: "not_found" } });
      const lineWhId = po.facility?.productionLineWarehouseId ?? null;
      const remaining = Math.max(0, po.plannedQty - po.actualQty);
      const planQty = remaining > 0 ? remaining : po.plannedQty;
      const leaves = await explodeMoBom(po.bom.id, planQty);
      const productIds = leaves.map((l) => l.productId);
      const stockWhere = lineWhId
        ? { productId: { in: productIds }, warehouseId: lineWhId }
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
      const issuedMap = await issuedQtyByProduct(po.orderNo, productIds);
      const lines = leaves.map((l) => {
        const s = stockMap.get(l.productId) ?? { onHand: 0, reserved: 0 };
        const free = s.onHand - s.reserved;
        const required = roundComponentQty(l.qty, l.uom);
        const issued = issuedMap.get(l.productId) ?? 0;
        const stillNeeded = round3(Math.max(0, required - issued));
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
        stockScope: lineWhId ? ("production_line" as const) : ("all" as const),
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
        defaultFacility: { select: { id: true, name: true } },
        defaultLine: { select: { id: true, name: true } },
        defaultMachine: { select: { id: true, name: true } },
      },
    });
    if (!bom) return reply.code(404).send({ error: { code: "bom_not_found" } });

    // Resolve facilityId: caller wins, then BOM default, then error.
    const facilityId = body.facilityId ?? bom.defaultFacilityId ?? null;
    if (!facilityId) {
      return reply.code(400).send({
        error: {
          code: "facility_required",
          message: "A production facility is required. Set one on the BOM or pass facilityId.",
        },
      });
    }
    // Validate the facility exists.
    const facility = await db.productionFacility.findUnique({
      where: { id: facilityId },
      select: { id: true, name: true },
    });
    if (!facility) {
      return reply.code(404).send({ error: { code: "facility_not_found" } });
    }

    // lineId may stay null — supervisor assigns later.
    const lineId = body.lineId ?? bom.defaultLineId ?? null;

    // Legacy station / machine text kept for backward compat.
    const station = body.station?.trim() || facility.name || "Assembly 1";
    const machine = body.machine?.trim() || bom.defaultMachine?.name || "—";

    const orderNo = await nextMoNo();
    const created = await db.productionOrder.create({
      data: {
        orderNo,
        bomId: body.bomId,
        station,
        facilityId,
        lineId: lineId ?? null,
        plannedQty: body.plannedQty,
        startDate: new Date(body.startDate),
        dueDate: new Date(body.dueDate),
      },
    });
    // Auto-create work orders from BOM operations (Odoo confirm MO).
    await createWorkOrdersFromBom(db, {
      productionOrderId: created.id,
      orderNo,
      plannedQty: body.plannedQty,
      station,
      machine,
      defaultLineId: lineId ?? null,
      bomId: body.bomId,
    });
    await recordChange("ProductionOrder", created.id, "insert", created, req.user.sub);
    return created;
  });

  // PATCH /production-orders/:id/assign-line
  // Supervisor action: assign an MO (and optionally its WOs) to a specific
  // production line within the MO's facility.
  app.patch(
    "/production-orders/:id/assign-line",
    { preHandler: [app.authenticate] },
    async (req, reply) => {
      if (!requireWriter(req, reply)) return;
      const id = (req.params as { id: string }).id;
      const body = assignLine.parse(req.body);

      const po = await db.productionOrder.findUnique({
        where: { id },
        select: { id: true, orderNo: true, facilityId: true, status: true },
      });
      if (!po) return reply.code(404).send({ error: { code: "not_found" } });
      if (po.status === "completed") {
        return reply.code(409).send({ error: { code: "already_completed" } });
      }

      // Validate that the requested line belongs to the MO's facility.
      const line = await db.productionLine.findUnique({
        where: { id: body.lineId },
        select: { id: true, name: true, facilityId: true },
      });
      if (!line) return reply.code(404).send({ error: { code: "line_not_found" } });
      if (po.facilityId && line.facilityId !== po.facilityId) {
        return reply.code(400).send({
          error: {
            code: "line_facility_mismatch",
            message: `Line "${line.name}" does not belong to this MO's production facility.`,
          },
        });
      }

      // Stamp the MO.
      const updated = await db.productionOrder.update({
        where: { id },
        data: { lineId: body.lineId },
      });

      // Optionally stamp individual WOs with line + machine.
      if (body.workOrderAssignments?.length) {
        for (const wa of body.workOrderAssignments) {
          await assignWorkOrderLineMachine(db, {
            productionOrderId: id,
            workOrderId: wa.workOrderId,
            lineId: wa.lineId ?? body.lineId,
            machineId: wa.machineId,
          });
        }
      }

      await recordChange("ProductionOrder", id, "update", updated, req.user.sub);
      return updated;
    }
  );

  // PATCH /production-orders/:id/work-orders/:woId/assign
  app.patch(
    "/production-orders/:id/work-orders/:woId/assign",
    { preHandler: [app.authenticate] },
    async (req, reply) => {
      if (!requireWriter(req, reply)) return;
      const { id, woId } = req.params as { id: string; woId: string };
      const body = assignWorkOrder.parse(req.body);
      try {
        const wo = await assignWorkOrderLineMachine(db, {
          productionOrderId: id,
          workOrderId: woId,
          lineId: body.lineId,
          machineId: body.machineId,
        });
        await recordChange("WorkOrder", woId, "update", wo, req.user.sub);
        return wo;
      } catch (e) {
        const err = e as Error & { statusCode?: number };
        return reply.code(err.statusCode ?? 400).send({
          error: { code: "assign_failed", message: err.message },
        });
      }
    }
  );

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
          bom: { select: { id: true, productId: true, variantId: true } },
          facility: {
            select: {
              id: true,
              description: true,
              replenishWarehouseCodes: true,
              productionLineWarehouse: { select: { id: true, code: true } },
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
        po.facility?.productionLineWarehouse?.id ?? null;

      const remaining = Math.max(0, po.plannedQty - po.actualQty);
      const planQty = remaining > 0 ? remaining : po.plannedQty;
      const leaves = await explodeMoBom(po.bom.id, planQty);

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
        const reqQty = roundComponentQty(leaf.qty, leaf.uom);
        const shortage = Math.max(0, reqQty - free);
        if (shortage > 0) {
          shortages.push({
            productId: leaf.productId,
            sku: leaf.sku,
            required: reqQty,
            available: free,
            shortage: round3(shortage),
          });
        }
      }

      const replenishCodes = po.facility
        ? facilityReplenishCodes(po.facility)
        : [];

      const transferOrderIds: string[] = [];

      // Create replenishment TOs for each shortage when a production-line
      // warehouse is configured. Group all shortages into a single TO
      // pulling from configured source warehouses (godowns + local storage).
      if (productionLineWhId && shortages.length > 0) {
        const toItems: Array<{
          productId: string;
          qtyRequested: number;
          fromBinId: string | null;
        }> = [];

        for (const sh of shortages) {
          const srcBin = await findReplenishmentSourceBin(
            sh.productId,
            replenishCodes,
            sh.shortage
          );
          toItems.push({
            productId: sh.productId,
            qtyRequested: sh.shortage,
            fromBinId: srcBin?.id ?? null,
          });
        }

        const unresolved = toItems.filter((it) => !it.fromBinId);
        if (unresolved.length > 0) {
          const skus = await db.product.findMany({
            where: { id: { in: unresolved.map((it) => it.productId) } },
            select: { id: true, sku: true },
          });
          const skuById = new Map(skus.map((p) => [p.id, p.sku]));
          return reply.code(409).send({
            error: {
              code: "replenish_source_not_found",
              message:
                "Cannot create replenishment transfer: no source bin with stock for " +
                unresolved
                  .map((it) => skuById.get(it.productId) ?? it.productId)
                  .join(", ") +
                ". Check STR / configured replenish warehouses.",
            },
            shortages,
            unresolvedSkus: unresolved.map(
              (it) => skuById.get(it.productId) ?? it.productId
            ),
          });
        }

        const firstSrcBin = await db.bin.findUnique({
          where: { id: toItems[0]!.fromBinId! },
          select: { warehouseId: true },
        });
        const fromWhId = firstSrcBin?.warehouseId;
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
                  fromBinId: it.fromBinId,
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
          ? po.facility?.productionLineWarehouse
          : null,
      };
    }
  );

  // POST /production-orders/:id/issue-materials
  // Consumes materials from inventory based on direct BOM components.
  // Writes one StockLedger row per (component, bin) and
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
          bom: { select: { id: true, productId: true, variantId: true } },
          facility: {
            select: {
              id: true,
              productionLineWarehouse: { select: { id: true } },
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
      const leaves = await explodeMoBom(po.bom.id, planQty);
      const productIds = leaves.map((l) => l.productId);
      const issuedMap = await issuedQtyByProduct(po.orderNo, productIds);
      const alreadyFullyIssued = leaves.every((l) => {
        const required = roundComponentQty(l.qty, l.uom);
        const issued = issuedMap.get(l.productId) ?? 0;
        return Math.max(0, required - issued) <= 0.0001;
      });
      if (alreadyFullyIssued) {
        return reply.code(409).send({
          error: {
            code: "materials_already_issued",
            message: `MO ${po.orderNo} already has all BOM materials issued.`,
          },
        });
      }

      // When the MO's facility has a production-line warehouse, issue
      // ONLY from that warehouse. If it doesn't have one, fall back to
      // the operator-specified warehouse (or any warehouse).
      const productionLineWhId =
        po.facility?.productionLineWarehouse?.id ?? null;

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
          (l) => (stockMap.get(l.productId) ?? 0) < roundComponentQty(l.qty, l.uom)
        );
        if (shortages.length > 0 && !body.allowShort) {
          return reply.code(409).send({
            error: {
              code: "short_at_production_line",
              message: `${shortages.length} component(s) are short at the production-line warehouse. Run POST /release to create replenishment transfers first.`,
              shortages: shortages.map((l) => ({
                sku: l.sku,
                required: roundComponentQty(l.qty, l.uom),
                available: round3(stockMap.get(l.productId) ?? 0),
              })),
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
        const requested = roundComponentQty(leaf.qty, leaf.uom);
        if (requested <= 0) continue;
        const componentVariantId = await resolveComponentVariantIdForMoIssue({
          moFgVariantId: po.bom.variantId,
          componentProductSku: leaf.sku,
        });
        const { issued: issuedForLeaf, binIds } = await issueMaterialFifo({
          productId: leaf.productId,
          warehouseId: preferredWhId,
          strictWarehouse: productionLineWhId !== null,
          qty: requested,
          ref: po.orderNo,
          variantId: componentVariantId,
        });
        for (const binId of binIds) decrementedBinIds.add(binId);

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
      // production lines panel reflects what's actually consuming material.
      const wos = await db.workOrder.findMany({
        where: { productionOrderId: id },
        select: { machine: true, machineId: true },
      });
      for (const w of wos) {
        if (w.machineId) {
          await setMachineStatusById(w.machineId, "running");
        } else {
          await setMachineStatusByName(w.machine, "running");
        }
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
            },
          },
          facility: {
            select: {
              id: true,
              productionLineWarehouse: { select: { id: true } },
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
        po.facility?.productionLineWarehouse?.id ?? null;
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
            },
          },
          facility: {
            select: {
              id: true,
              productionZone: true,
              productionLineWarehouse: { select: { id: true, code: true, kind: true } },
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
        po.facility?.productionLineWarehouse?.id ?? null;

      // ---- Auto-issue any unissued BOM materials so the ledger reflects
      // what was physically consumed. Without this, an MO completed
      // without an explicit Issue step shows ISSUED=0 / VARIANCE<0 on
      // the historical snapshot. We use the same FIFO util as
      // /issue-materials and write standard Issue ledger rows.
      try {
        const leaves = await explodeMoBom(po.bom.id, po.plannedQty);
        const productIds = leaves.map((l) => l.productId);
        const issuedMap = await issuedQtyByProduct(po.orderNo, productIds);
        const shortfalls = leaves
          .map((l) => {
            const required = roundComponentQty(l.qty, l.uom);
            const alreadyIssued = issuedMap.get(l.productId) ?? 0;
            const stillNeeded = round3(Math.max(0, required - alreadyIssued));
            return { leaf: l, required, alreadyIssued, stillNeeded };
          })
          .filter((s) => s.stillNeeded > 0.0001);

        if (shortfalls.length > 0) {
          const autoIssuePreferredWh = productionLineWhId ?? body.warehouseId ?? null;
          const autoIssued: Array<{ sku: string; requested: number; issued: number }> = [];
          let autoAnyShort = false;
          for (const s of shortfalls) {
            const componentVariantId = await resolveComponentVariantIdForMoIssue({
              moFgVariantId: po.bom.variantId,
              componentProductSku: s.leaf.sku,
            });
            const { issued: issuedForLeaf } = await issueMaterialFifo({
              productId: s.leaf.productId,
              warehouseId: autoIssuePreferredWh,
              // On completion we fall back to any warehouse if line is
              // empty — operators may have consumed from elsewhere.
              strictWarehouse: false,
              qty: s.stillNeeded,
              ref: po.orderNo,
              variantId: componentVariantId,
            });
            if (issuedForLeaf > 0) {
              await db.product.update({
                where: { id: s.leaf.productId },
                data: { stockOnHand: { decrement: issuedForLeaf } },
              });
            }
            autoIssued.push({
              sku: s.leaf.sku,
              requested: s.stillNeeded,
              issued: issuedForLeaf,
            });
            if (issuedForLeaf < s.stillNeeded) autoAnyShort = true;
          }
          if (autoAnyShort && !body.allowShortMaterials) {
            return reply.code(409).send({
              error: {
                code: "short_materials_at_complete",
                message:
                  "Some BOM components have no remaining stock to issue. Add stock and retry, or pass allowShortMaterials=true to complete with what was available.",
                shortfalls: autoIssued,
              },
            });
          }
        }
      } catch (err) {
        // Don't fail the whole completion if auto-issue has a soft
        // problem — log and continue. Hard validation errors above
        // (no_output / already_completed) already returned.
        req.log.warn({ err, orderNo: po.orderNo }, "auto-issue at complete failed");
      }

      const productionZone = po.facility?.productionZone ?? null;
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
            zone: productionZone ?? undefined,
            variantId: po.bom.variantId ?? null,
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
        receiveBin = await pickBinForReceive(
          productionLineWhId,
          po.bom.productId,
          productionZone,
          po.bom.variantId ?? null
        );
      }

      if (!receiveBin) {
        receiveBin = await pickBinForReceive(
          landingWhId,
          po.bom.productId,
          productionZone,
          po.bom.variantId ?? null
        );
      }

      if (!receiveBin) {
        return reply.code(409).send({
          error: {
            code: "no_receive_bin",
            message:
              "No receive slot could be resolved. Stock will land in a warehouse-level bulk slot when a warehouse is configured.",
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
        select: { machine: true, machineId: true },
      });
      for (const w of finishedWos) {
        if (w.machineId) {
          const stillBusy = await db.workOrder.findFirst({
            where: {
              machineId: w.machineId,
              status: { in: ["running", "queued"] },
              productionOrderId: { not: id },
            },
            select: { id: true },
          });
          if (!stillBusy) await setMachineStatusById(w.machineId, "idle");
        } else {
          if (!w.machine || w.machine === "—") continue;
          const stillBusy = await db.workOrder.findFirst({
            where: {
              machine: w.machine,
              status: { in: ["running", "queued"] },
              productionOrderId: { not: id },
            },
            select: { id: true },
          });
          if (!stillBusy) await setMachineStatusByName(w.machine, "idle");
        }
      }
      await recordChange("ProductionOrder", id, "update", updated, req.user.sub);
      scheduleStockRulesCheck("mo-complete", req.user.sub, req.log);
      return {
        productionOrder: updated,
        putaway,
        putawayTransferOrderId,
        byproductPostings,
      };
    }
  );

  // POST /production-orders/:id/split-operation — parallel lines (Odoo split MO)
  app.post(
    "/production-orders/:id/split-operation",
    { preHandler: [app.authenticate] },
    async (req, reply) => {
      if (!requireWriter(req, reply)) return;
      const id = (req.params as { id: string }).id;
      const body = z
        .object({
          bomOperationId: z.string().min(1),
          splits: z
            .array(
              z.object({
                lineId: z.string().min(1),
                machineId: z.string().min(1).nullable().optional(),
                qty: z.number().positive(),
              })
            )
            .min(1),
        })
        .parse(req.body);

      const po = await db.productionOrder.findUnique({ where: { id } });
      if (!po) return reply.code(404).send({ error: { code: "not_found" } });
      if (po.status === "completed") {
        return reply.code(409).send({ error: { code: "already_completed" } });
      }

      try {
        await splitOperationWorkOrders(db, {
          productionOrderId: id,
          orderNo: po.orderNo,
          bomOperationId: body.bomOperationId,
          plannedQty: po.plannedQty,
          station: po.station,
          machine: "—",
          splits: body.splits,
        });
      } catch (e) {
        return reply.code(400).send({
          error: { code: "split_failed", message: (e as Error).message },
        });
      }
      const wos = await db.workOrder.findMany({
        where: { productionOrderId: id },
        include: {
          bomOperation: { select: { seq: true, name: true } },
          line: { select: { id: true, code: true, name: true } },
        },
        orderBy: [{ bomOperationId: "asc" }, { splitSeq: "asc" }],
      });
      return { workOrders: wos };
    }
  );

  // POST /production-orders/:id/work-orders/:woId/start
  app.post(
    "/production-orders/:id/work-orders/:woId/start",
    { preHandler: [app.authenticate] },
    async (req, reply) => {
      if (!requireWriter(req, reply)) return;
      const woId = (req.params as { id: string; woId: string }).woId;
      try {
        const wo = await startWorkOrder(db, woId);
        return wo;
      } catch (e) {
        return reply.code(400).send({
          error: { code: "start_failed", message: (e as Error).message },
        });
      }
    }
  );

  // POST /production-orders/:id/work-orders/:woId/done
  app.post(
    "/production-orders/:id/work-orders/:woId/done",
    { preHandler: [app.authenticate] },
    async (req, reply) => {
      if (!requireWriter(req, reply)) return;
      const woId = (req.params as { id: string; woId: string }).woId;
      try {
        const result = await completeWorkOrder(db, woId);
        const wo = await db.workOrder.findUnique({ where: { id: woId } });
        return { ...result, workOrder: wo };
      } catch (e) {
        return reply.code(400).send({
          error: { code: "complete_failed", message: (e as Error).message },
        });
      }
    }
  );

  // POST /production-orders/:id/work-orders/:woId/qa — Odoo quality.check
  app.post(
    "/production-orders/:id/work-orders/:woId/qa",
    { preHandler: [app.authenticate] },
    async (req, reply) => {
      if (!requireWriter(req, reply)) return;
      const woId = (req.params as { id: string; woId: string }).woId;
      const body = z
        .object({
          pass: z.boolean(),
          notes: z.string().max(500).optional(),
        })
        .parse(req.body);
      try {
        const result = await recordWorkOrderQa(db, woId, body.pass, body.notes);
        const wo = await db.workOrder.findUnique({ where: { id: woId } });
        return { ...result, workOrder: wo };
      } catch (e) {
        return reply.code(400).send({
          error: { code: "qa_failed", message: (e as Error).message },
        });
      }
    }
  );

  // -------------------------------------------------------------------
  // Multi-machine parallel runs inside a single WorkOrder.
  //
  // A WO with no runs keeps legacy single-machine behavior (its
  // `output` is operator-managed). When >= 1 run exists, the WO output
  // is rolled up from sum(runs.goodQty) — each machine logs its own
  // partial input/output and the WO closes when all runs are done
  // (or the operator hits Done with rollup >= target).
  // -------------------------------------------------------------------

  const runCreate = z.object({
    machineId: z.string().min(1),
    lineId: z.string().min(1).nullable().optional(),
    plannedQty: z.number().nonnegative().nullable().optional(),
    operator: z.string().max(120).nullable().optional(),
  });
  const runPatch = z.object({
    goodQty: z.number().nonnegative().optional(),
    scrapQty: z.number().nonnegative().optional(),
    inputQty: z.number().nonnegative().optional(),
    notes: z.string().max(500).nullable().optional(),
    operator: z.string().max(120).nullable().optional(),
  });

  const runErr = (e: unknown, fallback: string) => {
    const err = e as { statusCode?: number; message?: string };
    return { status: err.statusCode ?? 400, code: fallback, message: err.message ?? fallback };
  };

  // POST /production-orders/:id/work-orders/:woId/runs — add a machine run
  app.post(
    "/production-orders/:id/work-orders/:woId/runs",
    { preHandler: [app.authenticate] },
    async (req, reply) => {
      if (!requireWriter(req, reply)) return;
      const { woId } = req.params as { id: string; woId: string };
      const body = runCreate.parse(req.body);
      try {
        const run = await addWorkOrderRun(db, {
          workOrderId: woId,
          machineId: body.machineId,
          lineId: body.lineId ?? undefined,
          plannedQty: body.plannedQty ?? null,
          operator: body.operator ?? null,
        });
        await recordChange("WorkOrderRun", run.id, "insert", run, req.user.sub);
        return run;
      } catch (e) {
        const err = runErr(e, "run_create_failed");
        return reply.code(err.status).send({ error: { code: err.code, message: err.message } });
      }
    }
  );

  // POST .../runs/:runId/start
  app.post(
    "/production-orders/:id/work-orders/:woId/runs/:runId/start",
    { preHandler: [app.authenticate] },
    async (req, reply) => {
      if (!requireWriter(req, reply)) return;
      const { woId, runId } = req.params as { woId: string; runId: string };
      try {
        const run = await startWorkOrderRun(db, woId, runId);
        await recordChange("WorkOrderRun", run.id, "update", run, req.user.sub);
        return run;
      } catch (e) {
        const err = runErr(e, "run_start_failed");
        return reply.code(err.status).send({ error: { code: err.code, message: err.message } });
      }
    }
  );

  // PATCH .../runs/:runId — log progress on a run (goodQty / scrapQty / inputQty / notes)
  app.patch(
    "/production-orders/:id/work-orders/:woId/runs/:runId",
    { preHandler: [app.authenticate] },
    async (req, reply) => {
      if (!requireWriter(req, reply)) return;
      const { woId, runId } = req.params as { woId: string; runId: string };
      const body = runPatch.parse(req.body);
      try {
        const run = await logWorkOrderRun(db, woId, runId, body);
        await recordChange("WorkOrderRun", run.id, "update", run, req.user.sub);
        return run;
      } catch (e) {
        const err = runErr(e, "run_log_failed");
        return reply.code(err.status).send({ error: { code: err.code, message: err.message } });
      }
    }
  );

  // POST .../runs/:runId/complete — close this run; final qty optional
  app.post(
    "/production-orders/:id/work-orders/:woId/runs/:runId/complete",
    { preHandler: [app.authenticate] },
    async (req, reply) => {
      if (!requireWriter(req, reply)) return;
      const { woId, runId } = req.params as { woId: string; runId: string };
      const body = runPatch.parse(req.body ?? {});
      try {
        const run = await completeWorkOrderRun(db, woId, runId, body);
        await recordChange("WorkOrderRun", run.id, "update", run, req.user.sub);
        return run;
      } catch (e) {
        const err = runErr(e, "run_complete_failed");
        return reply.code(err.status).send({ error: { code: err.code, message: err.message } });
      }
    }
  );

  // POST .../runs/:runId/abandon — mark a run abandoned (broken machine, swapped to another)
  app.post(
    "/production-orders/:id/work-orders/:woId/runs/:runId/abandon",
    { preHandler: [app.authenticate] },
    async (req, reply) => {
      if (!requireWriter(req, reply)) return;
      const { woId, runId } = req.params as { woId: string; runId: string };
      try {
        const run = await abandonWorkOrderRun(db, woId, runId);
        await recordChange("WorkOrderRun", run.id, "update", run, req.user.sub);
        return run;
      } catch (e) {
        const err = runErr(e, "run_abandon_failed");
        return reply.code(err.status).send({ error: { code: err.code, message: err.message } });
      }
    }
  );

  // DELETE .../runs/:runId — remove a queued/abandoned run row entirely
  app.delete(
    "/production-orders/:id/work-orders/:woId/runs/:runId",
    { preHandler: [app.authenticate] },
    async (req, reply) => {
      if (!requireWriter(req, reply)) return;
      const { woId, runId } = req.params as { woId: string; runId: string };
      try {
        const result = await deleteWorkOrderRun(db, woId, runId);
        await recordChange("WorkOrderRun", result.id, "delete", result, req.user.sub);
        return result;
      } catch (e) {
        const err = runErr(e, "run_delete_failed");
        return reply.code(err.status).send({ error: { code: err.code, message: err.message } });
      }
    }
  );

  // POST /production-orders/:id/cancel
  // Cancels an open MO: reverses material issues, cancels linked TOs,
  // closes work orders, sets status=cancelled.
  app.post(
    "/production-orders/:id/cancel",
    { preHandler: [app.authenticate] },
    async (req, reply) => {
      if (!requireWriter(req, reply)) return;
      const id = (req.params as { id: string }).id;
      try {
        const result = await cancelProductionOrder(id);
        const updated = await db.productionOrder.findUnique({ where: { id } });
        if (updated) {
          await recordChange("ProductionOrder", id, "update", updated, req.user.sub);
        }
        return result;
      } catch (e) {
        if (e instanceof MoCancelError) {
          return reply.code(e.statusCode).send({
            error: { code: e.code, message: e.message },
          });
        }
        throw e;
      }
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

