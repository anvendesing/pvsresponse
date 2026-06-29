// Post BOM by-product yields to inventory for an MO (log-output or run complete).

import type { PrismaClient } from "@prisma/client";
import { convertUom, UOMS } from "./uom.js";
import { pickBestBin, resolvePutawayDestination } from "./putaway.js";

type Db = PrismaClient;

const pickBinForReceive = async (
  db: Db,
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

export type MoByproductEntry = {
  bomByproductId: string;
  qty: number;
};

export type MoByproductPosting = {
  bomByproductId: string;
  productId: string;
  variantId: string | null;
  sku: string;
  name: string;
  qty: number;
  uom: string;
  bin: string;
};

/** Validate and post by-product rows to bins + stock ledger. */
export async function postMoByproductEntries(
  db: Db,
  opts: {
    productionOrderId: string;
    orderNo: string;
    landingWhId: string | null;
    entries: MoByproductEntry[];
    bpById: Map<
      string,
      {
        id: string;
        productId: string;
        variantId: string | null;
        uom: string;
        product: { id: string; sku: string; name: string; uom: string };
      }
    >;
  }
): Promise<MoByproductPosting[]> {
  const postings: MoByproductPosting[] = [];

  for (const entry of opts.entries.filter((e) => e.qty > 0)) {
    const bp = opts.bpById.get(entry.bomByproductId);
    if (!bp) {
      throw Object.assign(
        new Error(`Byproduct ${entry.bomByproductId} is not on this MO's BOM.`),
        { statusCode: 400, code: "byproduct_not_on_bom" }
      );
    }

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
      opts.landingWhId
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
        db,
        bpDest?.warehouseId ?? opts.landingWhId,
        bp.productId
      );
    }
    if (!bpBin) {
      throw Object.assign(
        new Error(
          `No bin available to receive byproduct ${bp.product.sku}. Configure putaway or add bin capacity.`
        ),
        { statusCode: 409, code: "no_byproduct_bin" }
      );
    }

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
        ref: opts.orderNo,
        qty: recvQty,
        balance: bpBin.qty + recvQty,
        date: new Date(),
      },
    });
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

    postings.push({
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

  return postings;
}

export async function loadMoByproductContext(db: Db, productionOrderId: string) {
  const po = await db.productionOrder.findUnique({
    where: { id: productionOrderId },
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
          productionLineWarehouse: { select: { id: true } },
        },
      },
    },
  });
  if (!po) {
    throw Object.assign(new Error("Production order not found."), {
      statusCode: 404,
      code: "not_found",
    });
  }
  const bpById = new Map(po.bom.byproducts.map((b) => [b.id, b]));
  const landingWhId = po.facility?.productionLineWarehouse?.id ?? null;
  return { po, bpById, landingWhId, orderNo: po.orderNo };
}
