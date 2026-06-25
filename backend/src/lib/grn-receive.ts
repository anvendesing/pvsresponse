/**
 * GRN receive: putaway-rule defaults + explicit bin allocations (multi-bin split).
 */

import type { Bin } from "@prisma/client";
import { db } from "../db.js";
import { binCodeFromRow } from "./codes.js";
import { resolvePutawayDestination, pickBestBin } from "./putaway.js";
import { formatLocationPath } from "./location-bin.js";
import { receiveStockLot } from "./stock-lots.js";

export type GrnReceiveBinOption = {
  id: string;
  code: string | null;
  zone: string;
  shelf: string;
  bin: string;
  label: string;
  qty: number;
  productId: string | null;
};

export type GrnReceiveHint = {
  productId: string;
  warehouseId: string;
  warehouseCode: string;
  warehouseName: string;
  defaultBinId: string | null;
  defaultBinCode: string | null;
  defaultBinLabel: string | null;
  bins: GrnReceiveBinOption[];
};

const binLabel = (
  b: { zone: string; shelf: string; bin: string },
  warehouseName?: string | null
) => formatLocationPath(b, warehouseName);

const warehouseInput = (wh: { code: string; scanPrefix: string | null }) => ({
  code: wh.code,
  scanPrefix: wh.scanPrefix,
});

export const getGrnReceiveHints = async (
  productIds: string[]
): Promise<Record<string, GrnReceiveHint>> => {
  const unique = [...new Set(productIds.filter(Boolean))];
  if (unique.length === 0) return {};

  const products = await db.product.findMany({
    where: { id: { in: unique } },
    select: { id: true },
  });
  const out: Record<string, GrnReceiveHint> = {};

  for (const product of products) {
    const dest = await resolvePutawayDestination(product.id, null, null);
    if (!dest) continue;

    const wh = await db.warehouse.findUnique({
      where: { id: dest.warehouseId },
      select: { id: true, code: true, name: true, scanPrefix: true },
    });
    if (!wh) continue;

    let defaultBin: Bin | null = null;
    if (dest.binId) {
      defaultBin = await db.bin.findUnique({ where: { id: dest.binId } });
    }
    if (!defaultBin) {
      defaultBin = await pickBestBin(wh.id, product.id, {
        allowEmptyBinFallback: true,
      });
    }

    const whBins = await db.bin.findMany({
      where: {
        warehouseId: wh.id,
        OR: [{ productId: null, qty: 0 }, { productId: product.id }],
      },
      orderBy: [{ zone: "asc" }, { shelf: "asc" }, { bin: "asc" }],
      take: 40,
    });

    const bins: GrnReceiveBinOption[] = whBins.map((b) => ({
      id: b.id,
      code: b.code ?? binCodeFromRow(b, warehouseInput(wh)),
      zone: b.zone,
      shelf: b.shelf,
      bin: b.bin,
      label: binLabel(b, wh.name),
      qty: b.qty,
      productId: b.productId,
    }));

    out[product.id] = {
      productId: product.id,
      warehouseId: wh.id,
      warehouseCode: wh.code,
      warehouseName: wh.name,
      defaultBinId: defaultBin?.id ?? null,
      defaultBinCode: defaultBin
        ? defaultBin.code ?? binCodeFromRow(defaultBin, warehouseInput(wh))
        : null,
      defaultBinLabel: defaultBin ? binLabel(defaultBin, wh.name) : null,
      bins,
    };
  }

  return out;
};

export type GrnAllocationInput = { binId: string; qty: number };

export const receiveGrnLineStock = async (args: {
  grnItemId: string;
  productId: string;
  variantId?: string | null;
  batchNo: string;
  qty: number;
  sourceRef: string;
  expiryDate?: Date | null;
  allocations?: GrnAllocationInput[];
}) => {
  const posts: Awaited<ReturnType<typeof receiveStockLot>>[] = [];

  if (args.allocations?.length) {
    const sum = args.allocations.reduce((s, a) => s + a.qty, 0);
    if (Math.abs(sum - args.qty) > 0.001) {
      throw new Error("allocation_qty_mismatch");
    }
    for (const alloc of args.allocations) {
      if (alloc.qty <= 0) continue;
      posts.push(
        await receiveStockLot({
          productId: args.productId,
          variantId: args.variantId ?? null,
          batchNo: args.batchNo,
          qty: alloc.qty,
          sourceRef: args.sourceRef,
          expiryDate: args.expiryDate,
          grnItemId: args.grnItemId,
          binId: alloc.binId,
        })
      );
    }
    return posts;
  }

  const dest = await resolvePutawayDestination(args.productId, args.variantId ?? null, null);
  posts.push(
    await receiveStockLot({
      productId: args.productId,
      variantId: args.variantId ?? null,
      batchNo: args.batchNo,
      qty: args.qty,
      sourceRef: args.sourceRef,
      expiryDate: args.expiryDate,
      grnItemId: args.grnItemId,
      warehouseId: dest?.warehouseId ?? null,
      binId: dest?.binId ?? null,
    })
  );
  return posts;
};
