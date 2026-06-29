// Daily production log — lightweight alternative to full MO workflow.
//
// Operator scans material barcodes (optional) then produced FG barcodes
// with quantities. We explode the BOM, issue components, and post
// finished goods directly to the putaway destination (stock room) —
// no MO, no work orders, no transfer order.

import { db } from "../db.js";
import { decodeLocation } from "./codes.js";
import { explodeMoBom, findActiveBomForProduct, type BomLeaf } from "./bom.js";
import { resolveProductScan } from "./resolve-product-scan.js";
import { pickBestBin, resolvePutawayDestination } from "./putaway.js";
import { issueMaterialFifo } from "./stock-lots.js";
import { resolveComponentVariantIdForMoIssue } from "./soap-semi.js";
import { checkStockRules } from "./stock-rules.js";

const UNIT_UOMS = new Set(["pc", "pcs", "piece", "pieces", "dozen", "pack", "box", "carton"]);

const isUnitUom = (uom: string | null | undefined) =>
  UNIT_UOMS.has((uom ?? "").trim().toLowerCase());

export const roundComponentQty = (qty: number, uom: string | null | undefined) => {
  if (isUnitUom(uom)) return Math.ceil(qty);
  return Math.round(qty * 1000) / 1000;
};

const round3 = (qty: number) => Math.round(qty * 1000) / 1000;

export type DailyOutputInput = { barcode: string; qty: number };
export type DailyMaterialScan = { barcode: string };

export type ResolvedOutput = {
  barcode: string;
  productId: string;
  variantId: string | null;
  sku: string;
  name: string;
  qty: number;
  bomId: string;
};

export type ResolvedMaterialHint = {
  barcode: string;
  kind: "bin" | "product";
  productId: string;
  variantId: string | null;
  sku: string;
  name: string;
  binId?: string;
  binCode?: string;
  binQty?: number;
};

export type MaterialRequirement = BomLeaf & {
  required: number;
  available: number;
};

export type OutputPreview = {
  barcode: string;
  sku: string;
  name: string;
  qty: number;
  bomId: string;
  materials: MaterialRequirement[];
};

export const nextDailyProductionNo = async (): Promise<string> => {
  const year = new Date().getUTCFullYear();
  const prefix = `DPL-${year}-`;
  const last = await db.auditLog.findFirst({
    where: { entity: "DailyProductionLog", entityId: { startsWith: prefix } },
    orderBy: { entityId: "desc" },
    select: { entityId: true },
  });
  const seq = last ? parseInt(last.entityId.slice(prefix.length), 10) || 0 : 0;
  return `${prefix}${String(seq + 1).padStart(4, "0")}`;
};

export const resolveOutputLine = async (
  input: DailyOutputInput
): Promise<ResolvedOutput> => {
  const barcode = input.barcode.trim();
  if (!barcode) throw new Error("Output barcode is required.");
  const qty = Number(input.qty);
  if (!Number.isFinite(qty) || qty <= 0) {
    throw new Error(`Invalid qty for ${barcode}.`);
  }

  const hit = await resolveProductScan(barcode);
  if (!hit) throw new Error(`Unknown product barcode: ${barcode}`);

  const bom = await findActiveBomForProduct(hit.productId, hit.variantId);
  if (!bom) {
    throw new Error(`No active BOM for ${hit.sku}. Create a BOM before logging production.`);
  }

  return {
    barcode,
    productId: hit.productId,
    variantId: hit.variantId,
    sku: hit.sku,
    name: hit.name,
    qty,
    bomId: bom.id,
  };
};

export const resolveMaterialScan = async (
  barcode: string
): Promise<ResolvedMaterialHint> => {
  const code = barcode.trim();
  if (!code) throw new Error("Material barcode is required.");

  const loc = decodeLocation(code);
  if (loc?.kind === "bin" && loc.shelf && loc.bin) {
    const wh = await db.warehouse.findFirst({
      where: {
        OR: [{ code: loc.warehouseCode }, { scanPrefix: loc.warehouseCode }],
      },
      select: { id: true, code: true, scanPrefix: true },
    });
    if (wh) {
      const bin = await db.bin.findFirst({
        where: {
          warehouseId: wh.id,
          zone: loc.zone,
          shelf: loc.shelf,
          bin: loc.bin,
        },
        include: {
          product: { select: { id: true, sku: true, name: true } },
          variant: { select: { id: true, sku: true } },
        },
      });
      if (bin?.productId && bin.product) {
        return {
          barcode: code,
          kind: "bin",
          productId: bin.productId,
          variantId: bin.variantId,
          sku: bin.variant?.sku ?? bin.product.sku,
          name: bin.product.name,
          binId: bin.id,
          binCode: code,
          binQty: bin.qty,
        };
      }
    }
  }

  const hit = await resolveProductScan(code);
  if (!hit) throw new Error(`Unknown material barcode: ${code}`);
  return {
    barcode: code,
    kind: "product",
    productId: hit.productId,
    variantId: hit.variantId,
    sku: hit.sku,
    name: hit.name,
  };
};

const stockOnHandFor = async (
  productId: string,
  variantId: string | null
): Promise<number> => {
  if (variantId) {
    const v = await db.productVariant.findUnique({
      where: { id: variantId },
      select: { stockOnHand: true },
    });
    return v?.stockOnHand ?? 0;
  }
  const p = await db.product.findUnique({
    where: { id: productId },
    select: { stockOnHand: true },
  });
  return p?.stockOnHand ?? 0;
};

export const previewDailyProduction = async (args: {
  outputs: DailyOutputInput[];
  materialScans?: DailyMaterialScan[];
}) => {
  if (args.outputs.length === 0) {
    return { outputs: [] as OutputPreview[], materialHints: [] as ResolvedMaterialHint[] };
  }

  const resolvedOutputs: ResolvedOutput[] = [];
  for (const o of args.outputs) {
    resolvedOutputs.push(await resolveOutputLine(o));
  }

  const materialHints: ResolvedMaterialHint[] = [];
  for (const m of args.materialScans ?? []) {
    try {
      materialHints.push(await resolveMaterialScan(m.barcode));
    } catch {
      // Preview ignores bad material scans; post will reject them.
    }
  }

  const agg = new Map<string, MaterialRequirement>();

  for (const out of resolvedOutputs) {
    const leaves = await explodeMoBom(out.bomId, out.qty);
    for (const leaf of leaves) {
      const required = roundComponentQty(leaf.qty, leaf.uom);
      const prev = agg.get(leaf.productId);
      if (prev) {
        prev.required = round3(prev.required + required);
        prev.qty = prev.required;
      } else {
        const available = await stockOnHandFor(leaf.productId, null);
        agg.set(leaf.productId, {
          ...leaf,
          required,
          qty: required,
          available: round3(available),
        });
      }
    }
  }

  const outputPreviews: OutputPreview[] = [];
  for (const out of resolvedOutputs) {
    const leaves = await explodeMoBom(out.bomId, out.qty);
    const materials: MaterialRequirement[] = [];
    for (const leaf of leaves) {
      const row = agg.get(leaf.productId)!;
      materials.push({
        ...leaf,
        required: roundComponentQty(leaf.qty, leaf.uom),
        qty: roundComponentQty(leaf.qty, leaf.uom),
        available: row.available,
      });
    }
    outputPreviews.push({
      barcode: out.barcode,
      sku: out.sku,
      name: out.name,
      qty: out.qty,
      bomId: out.bomId,
      materials,
    });
  }

  return {
    outputs: outputPreviews,
    materialHints,
    totals: Array.from(agg.values()).sort((a, b) => a.sku.localeCompare(b.sku)),
  };
};

const pickReceiveBin = async (
  productId: string,
  variantId: string | null
) => {
  const dest = await resolvePutawayDestination(productId, variantId, null);
  if (!dest) return null;

  if (dest.binId) {
    return db.bin.findUnique({ where: { id: dest.binId } });
  }
  if (dest.warehouseId) {
    return pickBestBin(dest.warehouseId, productId, {
      allowEmptyBinFallback: !dest.fixedBin,
      variantId: variantId ?? null,
    });
  }
  return null;
};

const issueFromBin = async (args: {
  binId: string;
  qty: number;
  ref: string;
  variantId?: string | null;
}) => {
  const bin = await db.bin.findUnique({ where: { id: args.binId } });
  if (!bin || !bin.productId) throw new Error("Bin has no stock to issue.");
  const take = Math.min(bin.qty, args.qty);
  if (take <= 0) return 0;

  await db.bin.update({
    where: { id: bin.id },
    data: { qty: { decrement: take } },
  });
  await db.stockLedger.create({
    data: {
      productId: bin.productId,
      variantId: args.variantId ?? bin.variantId ?? null,
      warehouseId: bin.warehouseId,
      bin: `${bin.zone}/${bin.shelf}/${bin.bin}`,
      txnType: "Issue",
      ref: args.ref,
      qty: -take,
      balance: bin.qty - take,
      date: new Date(),
    },
  });
  await db.product.update({
    where: { id: bin.productId },
    data: { stockOnHand: { decrement: take } },
  });
  return take;
};

const postFinishedGoods = async (args: {
  productId: string;
  variantId: string | null;
  qty: number;
  ref: string;
}) => {
  const recvQty = Math.round(args.qty);
  if (recvQty <= 0) return null;

  const receiveBin = await pickReceiveBin(args.productId, args.variantId);
  if (!receiveBin) {
    throw new Error("No putaway bin available for finished goods. Configure putaway rules.");
  }

  await db.bin.update({
    where: { id: receiveBin.id },
    data: {
      qty: { increment: recvQty },
      productId: receiveBin.productId ?? args.productId,
      variantId: receiveBin.variantId ?? args.variantId ?? null,
    },
  });
  await db.stockLedger.create({
    data: {
      productId: args.productId,
      variantId: args.variantId,
      warehouseId: receiveBin.warehouseId,
      bin: `${receiveBin.zone}/${receiveBin.shelf}/${receiveBin.bin}`,
      txnType: "Production",
      ref: args.ref,
      qty: recvQty,
      balance: receiveBin.qty + recvQty,
      date: new Date(),
    },
  });

  if (args.variantId) {
    await db.productVariant.update({
      where: { id: args.variantId },
      data: { stockOnHand: { increment: recvQty } },
    });
  } else {
    await db.product.update({
      where: { id: args.productId },
      data: { stockOnHand: { increment: recvQty } },
    });
  }

  const wh = await db.warehouse.findUnique({
    where: { id: receiveBin.warehouseId },
    select: { code: true },
  });

  return {
    binId: receiveBin.id,
    binCode: receiveBin.code ?? `${receiveBin.zone}/${receiveBin.shelf}/${receiveBin.bin}`,
    warehouseCode: wh?.code ?? "",
    zone: receiveBin.zone,
    qty: recvQty,
  };
};

export const postDailyProduction = async (args: {
  outputs: DailyOutputInput[];
  materialScans?: DailyMaterialScan[];
  notes?: string | null;
  allowShortMaterials?: boolean;
  userId: string;
  clientOpId?: string;
}) => {
  if (args.outputs.length === 0) {
    throw Object.assign(new Error("Add at least one produced item."), { statusCode: 400 });
  }

  if (args.clientOpId) {
    const dupKey = `daily-prod:${args.clientOpId}`;
    const seen = await db.auditLog.findFirst({
      where: { entity: "DailyProductionLog", entityId: dupKey },
      select: { after: true },
    });
    if (seen?.after) {
      const priorLogNo = JSON.parse(seen.after).logNo as string;
      const prior = await db.auditLog.findFirst({
        where: { entity: "DailyProductionLog", entityId: priorLogNo },
        select: { after: true },
      });
      if (prior?.after) return JSON.parse(prior.after);
    }
  }

  const logNo = await nextDailyProductionNo();

  const resolvedOutputs: ResolvedOutput[] = [];
  for (const o of args.outputs) {
    resolvedOutputs.push(await resolveOutputLine(o));
  }

  const materialHints: ResolvedMaterialHint[] = [];
  for (const m of args.materialScans ?? []) {
    materialHints.push(await resolveMaterialScan(m.barcode));
  }

  const requirements = new Map<
    string,
    { leaf: BomLeaf; required: number; fgVariantId: string | null }
  >();

  for (const out of resolvedOutputs) {
    const leaves = await explodeMoBom(out.bomId, out.qty);
    for (const leaf of leaves) {
      const add = roundComponentQty(leaf.qty, leaf.uom);
      const prev = requirements.get(leaf.productId);
      if (prev) {
        prev.required = round3(prev.required + add);
      } else {
        requirements.set(leaf.productId, {
          leaf,
          required: add,
          fgVariantId: out.variantId,
        });
      }
    }
  }

  const consumptions: Array<{
    productId: string;
    sku: string;
    name: string;
    qty: number;
    uom: string;
    source: string;
  }> = [];

  const binHintsByProduct = new Map<string, ResolvedMaterialHint[]>();
  for (const hint of materialHints) {
    const list = binHintsByProduct.get(hint.productId) ?? [];
    list.push(hint);
    binHintsByProduct.set(hint.productId, list);
  }

  const decrementedBinIds = new Set<string>();

  for (const [productId, req] of requirements) {
    let remaining = req.required;
    const componentVariantId = await resolveComponentVariantIdForMoIssue({
      moFgVariantId: req.fgVariantId,
      componentProductSku: req.leaf.sku,
    });

    for (const hint of binHintsByProduct.get(productId) ?? []) {
      if (remaining <= 0) break;
      if (hint.kind === "bin" && hint.binId) {
        const issued = await issueFromBin({
          binId: hint.binId,
          qty: remaining,
          ref: logNo,
          variantId: componentVariantId,
        });
        if (issued > 0) {
          remaining = round3(remaining - issued);
          decrementedBinIds.add(hint.binId);
          consumptions.push({
            productId,
            sku: req.leaf.sku,
            name: req.leaf.name,
            qty: issued,
            uom: req.leaf.uom,
            source: hint.binCode ?? hint.barcode,
          });
        }
      }
    }

    if (remaining > 0) {
      const { issued } = await issueMaterialFifo({
        productId,
        warehouseId: null,
        strictWarehouse: false,
        qty: remaining,
        ref: logNo,
        variantId: componentVariantId,
      });
      if (issued > 0) {
        await db.product.update({
          where: { id: productId },
          data: { stockOnHand: { decrement: issued } },
        });
        consumptions.push({
          productId,
          sku: req.leaf.sku,
          name: req.leaf.name,
          qty: issued,
          uom: req.leaf.uom,
          source: "FIFO",
        });
      }
      remaining = round3(remaining - issued);
    }

    if (remaining > 0.0001 && !args.allowShortMaterials) {
      throw Object.assign(
        new Error(
          `Insufficient ${req.leaf.sku}: need ${req.required}, short by ${remaining} ${req.leaf.uom}.`
        ),
        { statusCode: 409, code: "short_materials" }
      );
    }
  }

  const postings: Array<{
    productId: string;
    variantId: string | null;
    sku: string;
    name: string;
    qty: number;
    binId: string;
    binCode: string;
    warehouseCode: string;
    zone: string;
  }> = [];

  for (const out of resolvedOutputs) {
    const posted = await postFinishedGoods({
      productId: out.productId,
      variantId: out.variantId,
      qty: out.qty,
      ref: logNo,
    });
    if (posted) {
      postings.push({
        productId: out.productId,
        variantId: out.variantId,
        sku: out.sku,
        name: out.name,
        qty: posted.qty,
        binId: posted.binId,
        binCode: posted.binCode,
        warehouseCode: posted.warehouseCode,
        zone: posted.zone,
      });
    }
  }

  const payload = {
    logNo,
    notes: args.notes ?? null,
    outputs: resolvedOutputs.map((o) => ({
      sku: o.sku,
      name: o.name,
      qty: o.qty,
      barcode: o.barcode,
    })),
    materialScans: materialHints,
    consumptions,
    postings,
    loggedAt: new Date().toISOString(),
  };

  await db.auditLog.create({
    data: {
      userId: args.userId,
      action: "post",
      entity: "DailyProductionLog",
      entityId: logNo,
      after: JSON.stringify(payload),
    },
  });

  if (args.clientOpId) {
    await db.auditLog.create({
      data: {
        userId: args.userId,
        action: "post",
        entity: "DailyProductionLog",
        entityId: `daily-prod:${args.clientOpId}`,
        after: JSON.stringify({ logNo }),
      },
    });
  }

  for (const binId of decrementedBinIds) {
    await checkStockRules(binId, args.userId);
  }

  return payload;
};

export const listDailyProductionLogs = async (limit = 50) => {
  const rows = await db.auditLog.findMany({
    where: {
      entity: "DailyProductionLog",
      action: "post",
      NOT: { entityId: { startsWith: "daily-prod:" } },
    },
    orderBy: { createdAt: "desc" },
    take: limit,
    include: { user: { select: { id: true, name: true } } },
  });
  return rows.map((r) => {
    let parsed: Record<string, unknown> = {};
    try {
      parsed = r.after ? JSON.parse(r.after) : {};
    } catch {
      parsed = {};
    }
    return {
      logNo: r.entityId,
      loggedAt: r.createdAt,
      loggedBy: r.user?.name ?? "—",
      notes: (parsed.notes as string | null) ?? null,
      outputs: (parsed.outputs as unknown[]) ?? [],
      postings: (parsed.postings as unknown[]) ?? [],
    };
  });
};
