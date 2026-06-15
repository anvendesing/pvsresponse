// Mobile warehouse routes:
//   GET  /me/tasks           - tasks claimed by + available to the caller
//   GET  /locations/scan     - resolve any scanned code into the right level
//   POST /scan-events        - audit log of camera reads (forensics)
//
// All endpoints are JWT-authed; /me/tasks scopes to the caller's
// default warehouse (taken from the warehouseId query param so the
// device can switch warehouses without re-issuing a token).

import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { db } from "../db.js";
import { codesEqual } from "../lib/text-search.js";
import {
  binCodeFromRow,
  decodeLocation,
  encodeBin,
  encodeShelf,
} from "../lib/codes.js";

const variantSelect = {
  id: true,
  sku: true,
  barcode: true,
  size: true,
  color: true,
  grade: true,
  uom: true,
  stockOnHand: true,
} as const;

// Reusable selection for picks/packs surfaced on /me/tasks. Kept tiny
// because the mobile screen only needs counts + identifiers; the
// detail page hits /pick-lists/:id directly.
const taskSelect = {
  pickList: {
    id: true,
    pickListNo: true,
    status: true,
    salesOrderId: true,
    assignedToId: true,
    claimedAt: true,
    createdAt: true,
    updatedAt: true,
    salesOrder: {
      select: {
        soNo: true,
        customer: { select: { name: true, code: true, city: true } },
      },
    },
    _count: { select: { items: true } },
    assignedTo: { select: { id: true, name: true, username: true } },
  },
  packingSlip: {
    id: true,
    packingSlipNo: true,
    status: true,
    salesOrderId: true,
    assignedToId: true,
    claimedAt: true,
    createdAt: true,
    updatedAt: true,
    salesOrder: {
      select: {
        soNo: true,
        customer: { select: { name: true, code: true, city: true } },
      },
    },
    _count: { select: { items: true } },
    assignedTo: { select: { id: true, name: true, username: true } },
  },
} as const;

export const locationsRoutes = async (app: FastifyInstance) => {
  // ----------------------------------------------------------------- /me/tasks
  // Returns four buckets the mobile UI flips between:
  //   pickClaimed:  pick lists assignedTo me (status in draft|picking)
  //   pickAvailable: unassigned pick lists in draft|picking
  //   packClaimed:  packing slips assignedTo me (status open)
  //   packAvailable: unassigned packing slips in open
  //
  // Optional ?warehouseId filter scopes both buckets to the device's
  // selected warehouse. We derive the warehouse via SalesOrder.warehouseId
  // if it exists, falling back to the inventory warehouse on the SO -
  // a SO without a warehouse hint is shown to everyone (rare in practice).
  app.get(
    "/me/tasks",
    { preHandler: [app.authenticate] },
    async (req) => {
      const me = req.user.sub;
      const q = (req.query as Record<string, string>) ?? {};
      const limit = q.limit ? Math.min(parseInt(q.limit, 10) || 50, 200) : 50;

      const pickStatus = { in: ["draft", "picking"] };
      const packStatus = { in: ["open"] };

      const transferSelect = {
        id: true,
        transferNo: true,
        kind: true,
        status: true,
        fromWarehouseId: true,
        toWarehouseId: true,
        productionOrderId: true,
        assignedToId: true,
        claimedAt: true,
        createdAt: true,
        updatedAt: true,
        fromWarehouse: { select: { id: true, code: true, name: true, kind: true } },
        toWarehouse: { select: { id: true, code: true, name: true, kind: true } },
        productionOrder: { select: { id: true, orderNo: true } },
        assignedTo: { select: { id: true, name: true, username: true } },
        _count: { select: { items: true } },
      } as const;

      const transferStatus = { in: ["ready", "in_transit"] };

      const [pickClaimed, pickAvailable, packClaimed, packAvailable, transferClaimed, transferAvailable] = await Promise.all([
        db.pickList.findMany({
          where: { status: pickStatus, assignedToId: me },
          select: taskSelect.pickList,
          orderBy: { claimedAt: "desc" },
          take: limit,
        }),
        db.pickList.findMany({
          where: { status: pickStatus, assignedToId: null },
          select: taskSelect.pickList,
          orderBy: { createdAt: "asc" },
          take: limit,
        }),
        db.packingSlip.findMany({
          where: { status: packStatus, assignedToId: me },
          select: taskSelect.packingSlip,
          orderBy: { claimedAt: "desc" },
          take: limit,
        }),
        db.packingSlip.findMany({
          where: { status: packStatus, assignedToId: null },
          select: taskSelect.packingSlip,
          orderBy: { createdAt: "asc" },
          take: limit,
        }),
        db.transferOrder.findMany({
          where: { status: transferStatus, assignedToId: me },
          select: transferSelect,
          orderBy: { claimedAt: "desc" },
          take: limit,
        }),
        db.transferOrder.findMany({
          where: { status: transferStatus, assignedToId: null },
          select: transferSelect,
          orderBy: { createdAt: "asc" },
          take: limit,
        }),
      ]);

      return {
        pickClaimed,
        pickAvailable,
        packClaimed,
        packAvailable,
        transferClaimed,
        transferAvailable,
        counts: {
          pickClaimed: pickClaimed.length,
          pickAvailable: pickAvailable.length,
          packClaimed: packClaimed.length,
          packAvailable: packAvailable.length,
          transferClaimed: transferClaimed.length,
          transferAvailable: transferAvailable.length,
        },
      };
    }
  );

  // ------------------------------------------------------------ /locations/scan
  // Resolves any of: zone code, shelf code, bin code, or
  // a raw product SKU/barcode. Always returns 200 with `{ kind: ... }`
  // when something matched, or 404 when nothing did.
  app.get(
    "/locations/scan",
    { preHandler: [app.authenticate] },
    async (req, reply) => {
      const code = ((req.query as { code?: string })?.code ?? "").trim();
      if (!code) {
        return reply
          .code(400)
          .send({ error: { code: "missing_code", message: "code query param required" } });
      }

      const loc = decodeLocation(code);
      if (loc) {
        const wh = await db.warehouse.findFirst({
          where: {
            OR: [
              { code: loc.warehouseCode },
              { scanPrefix: loc.warehouseCode },
            ],
          },
          select: { id: true, code: true, name: true, scanPrefix: true },
        });
        if (!wh) {
          return reply.code(404).send({
            error: {
              code: "warehouse_not_found",
              message: `No warehouse with code '${loc.warehouseCode}'.`,
            },
          });
        }

        if (loc.kind === "zone") {
          const bins = await db.bin.findMany({
            where: { warehouseId: wh.id, zone: loc.zone },
            select: { shelf: true, qty: true, productId: true },
          });
          if (bins.length === 0) {
            return reply
              .code(404)
              .send({ error: { code: "zone_empty", message: "No bins in this zone." } });
          }
          const shelves = new Map<
            string,
            { shelf: string; bins: number; qty: number }
          >();
          for (const b of bins) {
            const key = b.shelf;
            const cur = shelves.get(key) ?? {
              shelf: b.shelf,
              bins: 0,
              qty: 0,
            };
            cur.bins += 1;
            cur.qty += b.qty ?? 0;
            shelves.set(key, cur);
          }
          return {
            kind: "zone",
            warehouse: wh,
            zone: loc.zone,
            shelves: Array.from(shelves.values())
              .map((s) => ({
                shelf: s.shelf,
                totalBins: s.bins,
                totalQty: s.qty,
                code: encodeShelf(wh.code, loc.zone, s.shelf),
              }))
              .sort((a, b) => a.shelf.localeCompare(b.shelf)),
          };
        }

        if (loc.kind === "shelf") {
          const bins = await db.bin.findMany({
            where: {
              warehouseId: wh.id,
              zone: loc.zone,
              shelf: loc.shelf,
            },
            include: {
              product: { select: { id: true, sku: true, name: true, uom: true } },
              variant: { select: variantSelect },
            },
            orderBy: { bin: "asc" },
          });
          if (bins.length === 0) {
            return reply
              .code(404)
              .send({ error: { code: "shelf_empty", message: "No bins on this shelf." } });
          }
          return {
            kind: "shelf",
            warehouse: wh,
            zone: loc.zone,
            shelf: loc.shelf,
            bins: bins.map((b) => ({
              id: b.id,
              code: b.code ?? binCodeFromRow(b, wh),
              bin: b.bin,
              qty: b.qty,
              reservedQty: b.reservedQty,
              capacity: b.capacity,
              batch: b.batch,
              variantId: b.variantId,
              product: b.product,
              variant: b.variant,
            })),
          };
        }

        // bin
        const bin = await db.bin.findFirst({
          where: {
            warehouseId: wh.id,
            zone: loc.zone,
            shelf: loc.shelf,
            bin: loc.bin,
          },
          include: {
            product: {
              select: {
                id: true,
                sku: true,
                name: true,
                uom: true,
                stockOnHand: true,
              },
            },
            variant: { select: variantSelect },
            warehouse: { select: { id: true, code: true, name: true, scanPrefix: true } },
          },
        });
        if (!bin) {
          return reply
            .code(404)
            .send({ error: { code: "bin_not_found", message: "Bin does not exist." } });
        }
        const recentMoves = await db.stockLedger.findMany({
          where: {
            warehouseId: wh.id,
            bin: `${bin.zone}/${bin.shelf}/${bin.bin}`,
          },
          orderBy: { date: "desc" },
          take: 10,
          select: {
            id: true,
            date: true,
            txnType: true,
            ref: true,
            qty: true,
            balance: true,
          },
        });
        const recentCounts = await db.binCount.findMany({
          where: { binId: bin.id },
          orderBy: { createdAt: "desc" },
          take: 5,
          include: {
            countedBy: { select: { id: true, name: true, username: true } },
          },
        });
        return {
          kind: "bin",
          warehouse: bin.warehouse,
          bin: {
            id: bin.id,
            code: bin.code ?? binCodeFromRow(bin, bin.warehouse),
            zone: bin.zone,
            shelf: bin.shelf,
            bin: bin.bin,
            qty: bin.qty,
            reservedQty: bin.reservedQty,
            capacity: bin.capacity,
            batch: bin.batch,
            variantId: bin.variantId,
            product: bin.product,
            variant: bin.variant,
          },
          recentMoves,
          recentCounts,
        };
      }

      // -------- Direct Bin.code lookup (compact or legacy stored codes).
      const upper = code.toUpperCase();
      const binByCode = await db.bin.findFirst({
        where: { code: upper },
        include: {
          product: {
            select: {
              id: true,
              sku: true,
              name: true,
              uom: true,
              stockOnHand: true,
            },
          },
          variant: { select: variantSelect },
          warehouse: { select: { id: true, code: true, name: true, scanPrefix: true } },
        },
      });
      if (binByCode) {
        const recentMoves = await db.stockLedger.findMany({
          where: {
            warehouseId: binByCode.warehouseId,
            bin: `${binByCode.zone}/${binByCode.shelf}/${binByCode.bin}`,
          },
          orderBy: { date: "desc" },
          take: 10,
          select: {
            id: true,
            date: true,
            txnType: true,
            ref: true,
            qty: true,
            balance: true,
          },
        });
        const recentCounts = await db.binCount.findMany({
          where: { binId: binByCode.id },
          orderBy: { createdAt: "desc" },
          take: 5,
          include: {
            countedBy: { select: { id: true, name: true, username: true } },
          },
        });
        return {
          kind: "bin",
          warehouse: binByCode.warehouse,
          bin: {
            id: binByCode.id,
            code:
              binByCode.code ??
              binCodeFromRow(binByCode, binByCode.warehouse),
            zone: binByCode.zone,
            shelf: binByCode.shelf,
            bin: binByCode.bin,
            qty: binByCode.qty,
            reservedQty: binByCode.reservedQty,
            capacity: binByCode.capacity,
            batch: binByCode.batch,
            variantId: binByCode.variantId,
            product: binByCode.product,
            variant: binByCode.variant,
          },
          recentMoves,
          recentCounts,
        };
      }

      // -------- Not a location code; try product/variant by SKU or barcode.
      const product = await db.product.findFirst({
        where: {
          OR: [
            { sku: { equals: upper } },
            { sku: { equals: code } },
            { barcode: { equals: upper } },
            { barcode: { equals: code } },
            {
              variants: {
                some: {
                  OR: [
                    { sku: { equals: upper } },
                    { sku: { equals: code } },
                    { barcode: { equals: upper } },
                    { barcode: { equals: code } },
                  ],
                },
              },
            },
          ],
        },
        include: {
          variants: {
            select: {
              id: true,
              sku: true,
              barcode: true,
              size: true,
              color: true,
              uom: true,
              packSize: true,
              stockOnHand: true,
            },
          },
        },
      });
      if (!product) {
        return reply
          .code(404)
          .send({ error: { code: "not_found", message: "Code did not match any location or product." } });
      }
      // Pin down which variant matched, if any.
      const matchedVariant = product.variants.find(
        (v) =>
          (v.sku && (codesEqual(v.sku, code) || v.sku.toUpperCase() === upper)) ||
          (v.barcode && codesEqual(v.barcode, code))
      );
      // Bin model only carries productId today (variants share a bin).
      // We surface every bin holding the parent product; the UI can
      // narrow by matchedVariantId if it cares about per-variant ATP.
      const bins = await db.bin.findMany({
        where: { productId: product.id, qty: { gt: 0 } },
        include: { warehouse: { select: { id: true, code: true } } },
        orderBy: { qty: "desc" },
        take: 50,
      });
      return {
        kind: "product",
        product: {
          id: product.id,
          sku: product.sku,
          name: product.name,
          uom: product.uom,
          stockOnHand: product.stockOnHand,
          variants: product.variants,
        },
        matchedVariantId: matchedVariant?.id ?? null,
        bins: bins.map((b) => ({
          id: b.id,
          code:
            b.code ?? binCodeFromRow(b, b.warehouse),
          warehouseCode: b.warehouse.code,
          zone: b.zone,
          shelf: b.shelf,
          bin: b.bin,
          qty: b.qty,
          reservedQty: b.reservedQty,
          batch: b.batch,
        })),
      };
    }
  );

  // ----------------------------------------------------------- /scan-events
  // Forensic + analytics log. Cheap rows, no PII. Used by supervisors
  // to spot misreads, dead spots, and pick-path inefficiencies.
  app.post(
    "/scan-events",
    { preHandler: [app.authenticate] },
    async (req, reply) => {
      const body = z
        .object({
          kind: z.enum(["bin", "shelf", "zone", "product", "unknown"]),
          code: z.string().min(1).max(120),
          context: z.string().max(120).nullable().optional(),
          outcome: z.enum(["ok", "mismatch", "not_found"]),
        })
        .parse(req.body);
      const created = await db.scanEvent.create({
        data: {
          userId: req.user.sub,
          kind: body.kind,
          code: body.code,
          context: body.context ?? null,
          outcome: body.outcome,
        },
      });
      return reply.code(201).send(created);
    }
  );

  // GET /scan-events?limit=100 - supervisor audit feed.
  app.get(
    "/scan-events",
    { preHandler: [app.authenticate] },
    async (req) => {
      const q = (req.query as Record<string, string>) ?? {};
      const limit = q.limit ? Math.min(parseInt(q.limit, 10) || 100, 500) : 100;
      return db.scanEvent.findMany({
        where: {
          ...(q.userId ? { userId: q.userId } : {}),
          ...(q.outcome ? { outcome: q.outcome } : {}),
          ...(q.kind ? { kind: q.kind } : {}),
        },
        include: {
          user: { select: { id: true, name: true, username: true } },
        },
        orderBy: { createdAt: "desc" },
        take: limit,
      });
    }
  );

  // Helper exposed for the desktop variance audit page.
  // GET /bin-counts?flagged=1&limit=200 - lists recent recounts/reassigns.
  app.get(
    "/bin-counts",
    { preHandler: [app.authenticate] },
    async (req) => {
      const q = (req.query as Record<string, string>) ?? {};
      const limit = q.limit ? Math.min(parseInt(q.limit, 10) || 100, 500) : 100;
      return db.binCount.findMany({
        where: {
          ...(q.flagged === "1" ? { flagged: true } : {}),
          ...(q.binId ? { binId: q.binId } : {}),
          ...(q.countedById ? { countedById: q.countedById } : {}),
        },
        include: {
          bin: {
            select: {
              id: true,
              code: true,
              zone: true,
              shelf: true,
              bin: true,
              warehouse: { select: { code: true, name: true } },
            },
          },
          countedBy: { select: { id: true, name: true, username: true } },
        },
        orderBy: { createdAt: "desc" },
        take: limit,
      });
    }
  );

};
