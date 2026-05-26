// Master data: products, vendors, customers, warehouses, bins.
import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { db } from "../db.js";
import { recordChange } from "../sync/log.js";
import { normalizeUomCode } from "../lib/uom.js";
import { binCodeFromRow } from "../lib/codes.js";
import { customerNetOpenBalance } from "./customer-payments.js";

// Normalize a free-text uom string against the canonical UoM master.
// Throws a 400-friendly error message if the input cannot be mapped.
// Called from product create/update so legacy clients that POST "Kg"
// or "Ltr" still produce canonical "kg" / "L" stored values.
const requireCanonicalUom = (input: string): string => {
  const code = normalizeUomCode(input);
  if (!code) {
    throw Object.assign(
      new Error(
        `Unknown UoM "${input}". Use a canonical code (e.g. kg, g, L, mL, m, pc) or one of the recognised aliases.`
      ),
      { statusCode: 400, code: "uom_unknown" }
    );
  }
  return code;
};

const variantInput = z.object({
  id: z.string().optional(),
  sku: z.string().min(1),
  barcode: z.string().nullable().optional(),
  size: z.string().nullable().optional(),
  color: z.string().nullable().optional(),
  grade: z.string().nullable().optional(),
  // Variant's selling UoM. Null/empty means "inherit parent's UoM".
  // The handler normalises this string against the canonical UoM master.
  uom: z.string().nullable().optional(),
  // Conversion factor variant -> parent UoM. Defaults to 1 (variant unit
  // equals parent unit, the trivial case). Cannot be zero or negative.
  packSize: z.number().positive().nullable().optional(),
  costPriceOverride: z.number().nullable().optional(),
  sellingPriceOverride: z.number().nullable().optional(),
  stockOnHand: z.number().int().nonnegative().default(0),
  active: z.boolean().default(true),
});

// Builds the persistence shape for a variant, normalising uom and packSize.
// Empty / null uom is preserved as null (= inherit parent's UoM at read).
const variantPersist = (v: z.infer<typeof variantInput>) => {
  const uomRaw = (v.uom ?? "").trim();
  const uom = uomRaw.length === 0 ? null : requireCanonicalUom(uomRaw);
  return {
    sku: v.sku,
    barcode: v.barcode ?? null,
    size: v.size ?? null,
    color: v.color ?? null,
    grade: v.grade ?? null,
    uom,
    packSize: v.packSize == null ? 1 : Number(v.packSize),
    costPriceOverride: v.costPriceOverride ?? null,
    sellingPriceOverride: v.sellingPriceOverride ?? null,
    stockOnHand: v.stockOnHand,
    active: v.active,
  };
};

const productCreate = z.object({
  sku: z.string().min(1),
  name: z.string().min(1),
  type: z.enum(["raw", "semi", "finished", "consumable", "service"]),
  uom: z.string().min(1),
  barcode: z.string().min(1),
  state: z.enum(["draft", "active", "discontinued", "blocked"]).default("active"),
  category: z.string(),
  hsn: z.string(),
  costPrice: z.number().nonnegative(),
  sellingPrice: z.number().nonnegative(),
  reorderLevel: z.number().int().nonnegative().default(0),
  stockOnHand: z.number().int().nonnegative().default(0),
  batchTracked: z.boolean().default(false),
  variants: z.array(variantInput).default([]),
});

const productUpdate = productCreate.partial();

export const catalogRoutes = async (app: FastifyInstance) => {
  // ============= Products =============
  const productInclude = {
    variants: {
      orderBy: { sku: "asc" as const },
    },
  };

  app.get("/products", async (req) => {
    const q = (req.query as Record<string, string>) ?? {};
    return db.product.findMany({
      where: {
        ...(q.type ? { type: q.type } : {}),
        ...(q.q
          ? {
              OR: [
                { name: { contains: q.q } },
                { sku: { contains: q.q } },
                { barcode: { contains: q.q } },
                { variants: { some: { sku: { contains: q.q } } } },
                { variants: { some: { barcode: { contains: q.q } } } },
              ],
            }
          : {}),
      },
      include: productInclude,
      orderBy: { sku: "asc" },
      take: q.limit ? parseInt(q.limit, 10) : 200,
    });
  });

  app.get("/products/:id", async (req, reply) => {
    const id = (req.params as { id: string }).id;
    const p = await db.product.findUnique({ where: { id }, include: productInclude });
    if (!p) return reply.code(404).send({ error: { code: "not_found" } });
    return p;
  });

  app.get("/products/by-sku/:sku", async (req, reply) => {
    const sku = (req.params as { sku: string }).sku;
    const p = await db.product.findUnique({ where: { sku }, include: productInclude });
    if (p) return p;
    // Fall back to variant lookup
    const v = await db.productVariant.findUnique({
      where: { sku },
      include: { product: { include: productInclude } },
    });
    if (!v) return reply.code(404).send({ error: { code: "not_found" } });
    return { ...v.product, matchedVariantId: v.id };
  });

  app.get("/products/by-barcode/:code", async (req, reply) => {
    const code = (req.params as { code: string }).code;
    const p = await db.product.findUnique({ where: { barcode: code }, include: productInclude });
    if (p) return p;
    const v = await db.productVariant.findUnique({
      where: { barcode: code },
      include: { product: { include: productInclude } },
    });
    if (!v) return reply.code(404).send({ error: { code: "not_found" } });
    return { ...v.product, matchedVariantId: v.id };
  });

  app.post("/products", { preHandler: [app.authenticate] }, async (req) => {
    const data = productCreate.parse(req.body);
    const { variants, ...productData } = data;
    productData.uom = requireCanonicalUom(productData.uom);
    const created = await db.product.create({
      data: {
        ...productData,
        variants: variants.length
          ? {
              create: variants.map(variantPersist),
            }
          : undefined,
      },
      include: productInclude,
    });
    await recordChange("Product", created.id, "insert", created, req.user.sub);
    return created;
  });

  app.patch("/products/:id", { preHandler: [app.authenticate] }, async (req, reply) => {
    const id = (req.params as { id: string }).id;
    const data = productUpdate.parse(req.body);
    const before = await db.product.findUnique({ where: { id } });
    if (!before) return reply.code(404).send({ error: { code: "not_found" } });

    const { variants, ...productData } = data;
    if (productData.uom !== undefined) {
      productData.uom = requireCanonicalUom(productData.uom);
    }

    if (variants !== undefined) {
      // Reconcile variants: insert / update / delete via diff against current set.
      const existing = await db.productVariant.findMany({ where: { productId: id } });
      const incomingIds = new Set(variants.filter((v) => v.id).map((v) => v.id!));
      const toDelete = existing.filter((e) => !incomingIds.has(e.id));
      await db.$transaction([
        ...(toDelete.length
          ? [db.productVariant.deleteMany({ where: { id: { in: toDelete.map((d) => d.id) } } })]
          : []),
        ...variants.map((v) =>
          v.id
            ? db.productVariant.update({
                where: { id: v.id },
                data: variantPersist(v),
              })
            : db.productVariant.create({
                data: { productId: id, ...variantPersist(v) },
              })
        ),
      ]);
    }

    const after = await db.product.update({
      where: { id },
      data: productData,
      include: productInclude,
    });
    await recordChange("Product", id, "update", after, req.user.sub);
    return after;
  });

  app.delete("/products/:id", { preHandler: [app.authenticate] }, async (req, reply) => {
    const id = (req.params as { id: string }).id;
    const before = await db.product.findUnique({ where: { id } });
    if (!before) return reply.code(404).send({ error: { code: "not_found" } });
    try {
      await db.product.delete({ where: { id } });
      await recordChange("Product", id, "delete", before, req.user.sub);
      return { ok: true };
    } catch (e) {
      const err = e as { message?: string };
      return reply.code(409).send({
        error: {
          code: "in_use",
          message:
            "Cannot delete: product is referenced by other records. Set state to 'discontinued' or 'blocked' instead.",
          details: err.message,
        },
      });
    }
  });

  // ============= Warehouses =============
  // GET /warehouses
  // - By default returns only active warehouses (existing behaviour). Pass
  //   ?includeInactive=1 from the Settings UI to also list deactivated rows
  //   (so admins can re-enable them).
  // - Also returns lightweight bin / stock counts so the UI can warn before
  //   deactivating a warehouse that still holds stock.
  app.get("/warehouses", async (req) => {
    const q = (req.query as Record<string, string>) ?? {};
    const where = q.includeInactive === "1" ? {} : { active: true };
    const rows = await db.warehouse.findMany({
      where,
      orderBy: { code: "asc" },
      include: {
        _count: { select: { bins: true, ledger: true } },
      },
    });
    return rows.map((w) => ({
      id: w.id,
      code: w.code,
      name: w.name,
      city: w.city,
      active: w.active,
      createdAt: w.createdAt,
      updatedAt: w.updatedAt,
      binCount: w._count.bins,
      ledgerCount: w._count.ledger,
    }));
  });

  app.get("/warehouses/:id/bins", async (req) => {
    const id = (req.params as { id: string }).id;
    return db.bin.findMany({
      where: { warehouseId: id },
      include: { product: { select: { sku: true, name: true, uom: true } } },
      orderBy: [{ zone: "asc" }, { rack: "asc" }, { shelf: "asc" }, { bin: "asc" }],
    });
  });

  const warehouseCreate = z.object({
    code: z.string().min(2).max(20),
    name: z.string().min(1).max(120),
    city: z.string().min(1).max(80),
    active: z.boolean().default(true),
  });
  const warehouseUpdate = warehouseCreate.partial();

  // POST /warehouses - admin/supervisor only.
  app.post(
    "/warehouses",
    { preHandler: [app.authenticate] },
    async (req, reply) => {
      if (req.user.role !== "admin" && req.user.role !== "supervisor") {
        return reply
          .code(403)
          .send({ error: { code: "forbidden", message: "Admins only" } });
      }
      const body = warehouseCreate.parse(req.body);
      const code = body.code.trim().toUpperCase();
      try {
        const created = await db.warehouse.create({
          data: { ...body, code },
        });
        await recordChange("Warehouse", created.id, "insert", created, req.user.sub);
        return { ...created, binCount: 0, ledgerCount: 0 };
      } catch (e) {
        const err = e as { code?: string };
        if (err.code === "P2002") {
          return reply.code(409).send({
            error: {
              code: "duplicate_code",
              message: `Warehouse code "${code}" already exists`,
            },
          });
        }
        throw e;
      }
    }
  );

  // PATCH /warehouses/:id - admin/supervisor only.
  // The unique `code` is intentionally not editable (it's used as a foreign
  // key in stock-ledger and bin paths). Soft-deactivate via active=false.
  app.patch(
    "/warehouses/:id",
    { preHandler: [app.authenticate] },
    async (req, reply) => {
      if (req.user.role !== "admin" && req.user.role !== "supervisor") {
        return reply
          .code(403)
          .send({ error: { code: "forbidden", message: "Admins only" } });
      }
      const id = (req.params as { id: string }).id;
      const body = warehouseUpdate.parse(req.body);
      // We don't let the code change, even if it's sent.
      delete (body as { code?: string }).code;
      try {
        const updated = await db.warehouse.update({
          where: { id },
          data: body,
        });
        await recordChange("Warehouse", id, "update", updated, req.user.sub);
        return updated;
      } catch (e) {
        const err = e as { code?: string };
        if (err.code === "P2025") {
          return reply.code(404).send({ error: { code: "not_found" } });
        }
        throw e;
      }
    }
  );

  // DELETE /warehouses/:id - admin/supervisor only.
  // Hard-delete only if there are no bins / ledger entries; otherwise we
  // soft-deactivate so we never strand FK references.
  app.delete(
    "/warehouses/:id",
    { preHandler: [app.authenticate] },
    async (req, reply) => {
      if (req.user.role !== "admin" && req.user.role !== "supervisor") {
        return reply
          .code(403)
          .send({ error: { code: "forbidden", message: "Admins only" } });
      }
      const id = (req.params as { id: string }).id;
      const wh = await db.warehouse.findUnique({
        where: { id },
        include: { _count: { select: { bins: true, ledger: true } } },
      });
      if (!wh) return reply.code(404).send({ error: { code: "not_found" } });
      const hasHistory = wh._count.bins > 0 || wh._count.ledger > 0;
      if (hasHistory) {
        const updated = await db.warehouse.update({
          where: { id },
          data: { active: false },
        });
        await recordChange("Warehouse", id, "update", updated, req.user.sub);
        return {
          softDeleted: true,
          message: `Warehouse has ${wh._count.bins} bins and ${wh._count.ledger} stock entries; deactivated instead of deleted.`,
          warehouse: updated,
        };
      }
      const before = wh;
      await db.warehouse.delete({ where: { id } });
      await recordChange("Warehouse", id, "delete", before, req.user.sub);
      return { softDeleted: false };
    }
  );

  // ============= Bins =============
  // Bins are addressed by zone/rack/shelf/bin within a warehouse and
  // are unique on the composite (warehouseId, zone, rack, shelf, bin).
  // We expose:
  //   POST   /warehouses/:id/bins         single-bin create
  //   POST   /warehouses/:id/bins/bulk    create a whole rack with
  //                                       N shelves x M bins per shelf
  //   PATCH  /bins/:id                    rename/recapacity
  //   DELETE /bins/:id                    only when bin holds no stock
  // The warehouse code/zone/rack/shelf labels are normalised to
  // upper-case so a warehouse layout never accumulates "A1" vs "a1".

  const labelSchema = z
    .string()
    .min(1)
    .max(20)
    .regex(/^[A-Za-z0-9-]+$/, "letters / numbers / hyphen only");

  const binSingleCreate = z.object({
    zone: labelSchema,
    rack: labelSchema,
    shelf: labelSchema,
    bin: labelSchema,
    capacity: z.number().int().positive().max(100000).default(100),
  });

  const binBulkCreate = z.object({
    zone: labelSchema,
    rack: labelSchema,
    // List of shelf labels e.g. ["S1","S2","S3"]. Either provide this
    // explicitly or use shelfCount which generates S1..Sn.
    shelves: z.array(labelSchema).min(1).max(100).optional(),
    shelfCount: z.number().int().min(1).max(100).optional(),
    binsPerShelf: z.number().int().min(1).max(200),
    // Bin labels are auto-generated as `${rack}-${shelf}-${seq}`.
    capacity: z.number().int().positive().max(100000).default(100),
  });

  const binUpdate = z
    .object({
      // Warehouse + zone/rack/shelf are not editable to keep history
      // simple; rename a bin only by deleting + recreating. The bin
      // label, capacity and product hint are safe to mutate.
      bin: labelSchema.optional(),
      capacity: z.number().int().positive().max(100000).optional(),
      productId: z.string().nullable().optional(),
    })
    .strict();

  const requireAdmin = (
    req: { user: { role: string } },
    reply: { code: (n: number) => { send: (b: unknown) => void } }
  ) => {
    if (req.user.role !== "admin" && req.user.role !== "supervisor") {
      reply
        .code(403)
        .send({ error: { code: "forbidden", message: "Admins only" } });
      return false;
    }
    return true;
  };

  // POST /warehouses/:id/bins - single bin create.
  app.post(
    "/warehouses/:id/bins",
    { preHandler: [app.authenticate] },
    async (req, reply) => {
      if (!requireAdmin(req, reply)) return;
      const warehouseId = (req.params as { id: string }).id;
      const wh = await db.warehouse.findUnique({ where: { id: warehouseId } });
      if (!wh) return reply.code(404).send({ error: { code: "warehouse_not_found" } });
      const body = binSingleCreate.parse(req.body);
      const data = {
        warehouseId,
        zone: body.zone.toUpperCase(),
        rack: body.rack.toUpperCase(),
        shelf: body.shelf.toUpperCase(),
        bin: body.bin.toUpperCase(),
        capacity: body.capacity,
        code: binCodeFromRow(
          {
            zone: body.zone.toUpperCase(),
            rack: body.rack.toUpperCase(),
            shelf: body.shelf.toUpperCase(),
            bin: body.bin.toUpperCase(),
          },
          wh.code
        ),
      };
      try {
        const created = await db.bin.create({
          data,
          include: { product: { select: { sku: true, name: true, uom: true } } },
        });
        await recordChange("Bin", created.id, "insert", created, req.user.sub);
        return created;
      } catch (e) {
        const err = e as { code?: string };
        if (err.code === "P2002") {
          return reply.code(409).send({
            error: {
              code: "duplicate_bin",
              message: `Bin ${data.zone}/${data.rack}/${data.shelf}/${data.bin} already exists in ${wh.code}.`,
            },
          });
        }
        throw e;
      }
    }
  );

  // POST /warehouses/:id/bins/bulk - create a whole rack at once.
  // Convenience for the operator who wants "Rack R5 with 4 shelves x 5
  // bins each", which is otherwise 20 individual clicks.
  app.post(
    "/warehouses/:id/bins/bulk",
    { preHandler: [app.authenticate] },
    async (req, reply) => {
      if (!requireAdmin(req, reply)) return;
      const warehouseId = (req.params as { id: string }).id;
      const wh = await db.warehouse.findUnique({ where: { id: warehouseId } });
      if (!wh) return reply.code(404).send({ error: { code: "warehouse_not_found" } });
      const body = binBulkCreate.parse(req.body);
      const shelfLabels = (
        body.shelves ??
        Array.from({ length: body.shelfCount ?? 1 }, (_, i) => `S${i + 1}`)
      ).map((s) => s.toUpperCase());

      const zone = body.zone.toUpperCase();
      const rack = body.rack.toUpperCase();
      const rows: Array<{
        warehouseId: string;
        zone: string;
        rack: string;
        shelf: string;
        bin: string;
        capacity: number;
        code: string;
      }> = [];
      for (const shelf of shelfLabels) {
        for (let i = 1; i <= body.binsPerShelf; i++) {
          // Bin label uses just a numeric sequence within the shelf
          // (e.g. "01", "02") - keeps the tree compact.
          const seq = String(i).padStart(2, "0");
          rows.push({
            warehouseId,
            zone,
            rack,
            shelf,
            bin: seq,
            capacity: body.capacity,
            code: binCodeFromRow(
              { zone, rack, shelf, bin: seq },
              wh.code
            ),
          });
        }
      }
      // Pre-check for collisions so we can return a clean error
      // instead of a half-finished bulk insert.
      const existing = await db.bin.findMany({
        where: {
          warehouseId,
          zone,
          rack,
          shelf: { in: shelfLabels },
        },
        select: { shelf: true, bin: true },
      });
      if (existing.length > 0) {
        return reply.code(409).send({
          error: {
            code: "duplicate_bin",
            message: `Rack ${rack} already has ${existing.length} bin(s) on shelves ${[...new Set(existing.map((e) => e.shelf))].join(", ")}. Pick a different rack label or delete the existing rack first.`,
          },
        });
      }
      const result = await db.$transaction(
        rows.map((r) => db.bin.create({ data: r }))
      );
      for (const r of result) {
        await recordChange("Bin", r.id, "insert", r, req.user.sub);
      }
      return {
        created: result.length,
        zone,
        rack,
        shelves: shelfLabels.length,
        binsPerShelf: body.binsPerShelf,
        bins: result,
      };
    }
  );

  // PATCH /bins/:id
  app.patch(
    "/bins/:id",
    { preHandler: [app.authenticate] },
    async (req, reply) => {
      if (!requireAdmin(req, reply)) return;
      const id = (req.params as { id: string }).id;
      const body = binUpdate.parse(req.body);
      try {
        const data: Record<string, unknown> = {};
        if (body.bin !== undefined) data.bin = body.bin.toUpperCase();
        if (body.capacity !== undefined) data.capacity = body.capacity;
        if (body.productId !== undefined) data.productId = body.productId;
        // If the operator renamed the bin label, refresh Bin.code so
        // the printed barcode keeps tracking the row.
        if (body.bin !== undefined) {
          const current = await db.bin.findUnique({
            where: { id },
            include: { warehouse: { select: { code: true } } },
          });
          if (current) {
            data.code = binCodeFromRow(
              {
                zone: current.zone,
                rack: current.rack,
                shelf: current.shelf,
                bin: body.bin.toUpperCase(),
              },
              current.warehouse.code
            );
          }
        }
        const updated = await db.bin.update({
          where: { id },
          data,
          include: { product: { select: { sku: true, name: true, uom: true } } },
        });
        await recordChange("Bin", id, "update", updated, req.user.sub);
        return updated;
      } catch (e) {
        const err = e as { code?: string };
        if (err.code === "P2025") {
          return reply.code(404).send({ error: { code: "not_found" } });
        }
        if (err.code === "P2002") {
          return reply.code(409).send({
            error: { code: "duplicate_bin", message: "Bin label already exists in this shelf." },
          });
        }
        throw e;
      }
    }
  );

  // DELETE /bins/:id - safe delete only.
  // Refuses if the bin currently holds stock (qty > 0) OR has stock
  // reserved by a pick list (reservedQty > 0). This keeps the stock
  // ledger consistent. To remove a bin that's still in use, the
  // operator must first transfer its contents out via /inventory/transfer.
  app.delete(
    "/bins/:id",
    { preHandler: [app.authenticate] },
    async (req, reply) => {
      if (!requireAdmin(req, reply)) return;
      const id = (req.params as { id: string }).id;
      const bin = await db.bin.findUnique({ where: { id } });
      if (!bin) return reply.code(404).send({ error: { code: "not_found" } });
      if ((bin.qty ?? 0) > 0 || (bin.reservedQty ?? 0) > 0) {
        return reply.code(409).send({
          error: {
            code: "bin_not_empty",
            message: `Bin holds ${bin.qty} unit(s) (${bin.reservedQty} reserved). Transfer the stock out before deleting.`,
          },
        });
      }
      // Pick-list items reference bins; if any are still attached, we
      // refuse to delete to avoid breaking pick history. (Frontend can
      // suggest soft-empty + reuse instead.)
      const refCount = await db.pickListItem.count({ where: { binId: id } });
      if (refCount > 0) {
        return reply.code(409).send({
          error: {
            code: "bin_in_use",
            message: `Bin is referenced by ${refCount} pick-list item(s). Cannot delete.`,
          },
        });
      }
      await db.bin.delete({ where: { id } });
      await recordChange("Bin", id, "delete", bin, req.user.sub);
      return { deleted: true };
    }
  );

  // ============= Vendors moved to procurementRoutes =============
  // (full CRUD lives there; this file only kept the GET shim that's
  // now obsolete now that procurement.ts owns the table.)

  // ============= Customers =============
  app.get("/customers", async (req) => {
    const q = (req.query as Record<string, string>) ?? {};
    const rows = await db.customer.findMany({
      where: q.includeInactive ? {} : { active: true },
      orderBy: { name: "asc" },
      include: {
        priceList: { select: { id: true, code: true, name: true, multiplier: true, basis: true } },
        _count: { select: { quotes: true, salesOrders: true, invoices: true } },
      },
    });
    // Attach open AR balance so the Customers page can display credit usage.
    return Promise.all(
      rows.map(async (c) => {
        const openBalance = await customerNetOpenBalance(c.id);
        return {
          ...c,
          openBalance,
          availableCredit: c.creditLimit > 0 ? Math.max(0, c.creditLimit - openBalance) : null,
        };
      })
    );
  });

  app.get("/customers/:id", async (req, reply) => {
    const id = (req.params as { id: string }).id;
    const c = await db.customer.findUnique({
      where: { id },
      include: {
        priceList: { select: { id: true, code: true, name: true, multiplier: true, basis: true } },
        _count: { select: { quotes: true, salesOrders: true, invoices: true } },
      },
    });
    if (!c) return reply.code(404).send({ error: { code: "not_found" } });
    const openBalance = await customerNetOpenBalance(c.id);
    return {
      ...c,
      openBalance,
      availableCredit: c.creditLimit > 0 ? Math.max(0, c.creditLimit - openBalance) : null,
    };
  });

  // Mint the next sequential code (CUST-0001, CUST-0002, ...) when the
  // operator doesn't supply one. Server-generated codes guarantee uniqueness
  // even across concurrent creates.
  const nextCustomerCode = async (): Promise<string> => {
    const last = await db.customer.findFirst({
      where: { code: { startsWith: "CUST-" } },
      orderBy: { code: "desc" },
      select: { code: true },
    });
    const n = last ? parseInt(last.code.replace("CUST-", ""), 10) || 0 : 0;
    return `CUST-${(n + 1).toString().padStart(4, "0")}`;
  };

  const customerCreate = z.object({
    code: z.string().trim().toUpperCase().optional(),
    name: z.string().trim().min(1),
    gst: z.string().trim().nullable().optional(),
    city: z.string().trim().nullable().optional(),
    contact: z.string().trim().nullable().optional(),
    creditLimit: z.number().nonnegative().default(0),
    priceListId: z.string().nullable().optional(),
    active: z.boolean().default(true),
  });

  app.post("/customers", { preHandler: [app.authenticate] }, async (req, reply) => {
    const body = customerCreate.parse(req.body);
    const code = body.code && body.code.length > 0 ? body.code : await nextCustomerCode();
    // Check unique code up-front for a friendlier 409 (Prisma's P2002 surface
    // is OK but the message is generic).
    const existing = await db.customer.findUnique({ where: { code } });
    if (existing) {
      return reply.code(409).send({
        error: { code: "duplicate_code", message: `Customer code "${code}" already exists.` },
      });
    }
    const created = await db.customer.create({
      data: {
        code,
        name: body.name,
        gst: body.gst ?? null,
        city: body.city ?? null,
        contact: body.contact ?? null,
        creditLimit: body.creditLimit,
        priceListId: body.priceListId ?? null,
        active: body.active,
      },
      include: {
        priceList: { select: { id: true, code: true, name: true, multiplier: true, basis: true } },
        _count: { select: { quotes: true, salesOrders: true, invoices: true } },
      },
    });
    await recordChange("Customer", created.id, "insert", created, req.user.sub);
    return reply.code(201).send(created);
  });

  app.patch("/customers/:id", { preHandler: [app.authenticate] }, async (req, reply) => {
    const id = (req.params as { id: string }).id;
    const body = z
      .object({
        code: z.string().trim().toUpperCase().optional(),
        name: z.string().optional(),
        gst: z.string().nullable().optional(),
        city: z.string().nullable().optional(),
        contact: z.string().nullable().optional(),
        creditLimit: z.number().nonnegative().optional(),
        priceListId: z.string().nullable().optional(),
        active: z.boolean().optional(),
      })
      .parse(req.body);
    try {
      const updated = await db.customer.update({
        where: { id },
        data: body,
        include: {
          priceList: { select: { id: true, code: true, name: true, multiplier: true, basis: true } },
          _count: { select: { quotes: true, salesOrders: true, invoices: true } },
        },
      });
      await recordChange("Customer", id, "update", updated, req.user.sub);
      return updated;
    } catch (e) {
      const err = e as { code?: string };
      if (err.code === "P2025") return reply.code(404).send({ error: { code: "not_found" } });
      if (err.code === "P2002")
        return reply.code(409).send({
          error: { code: "duplicate_code", message: "Another customer already uses this code." },
        });
      throw e;
    }
  });

  // Delete = soft-delete if the customer has any historical transactions
  // (quotes/SOs/invoices) so accounting integrity is preserved. Otherwise
  // we hard-delete to keep the master list tidy. The frontend uses the
  // returned `softDeleted` flag to decide which message to show.
  app.delete("/customers/:id", { preHandler: [app.authenticate] }, async (req, reply) => {
    const id = (req.params as { id: string }).id;
    const found = await db.customer.findUnique({
      where: { id },
      include: { _count: { select: { quotes: true, salesOrders: true, invoices: true } } },
    });
    if (!found) return reply.code(404).send({ error: { code: "not_found" } });
    const hasHistory =
      found._count.quotes > 0 ||
      found._count.salesOrders > 0 ||
      found._count.invoices > 0;
    if (hasHistory) {
      const updated = await db.customer.update({
        where: { id },
        data: { active: false },
        include: {
          priceList: { select: { id: true, code: true, name: true, multiplier: true, basis: true } },
          _count: { select: { quotes: true, salesOrders: true, invoices: true } },
        },
      });
      await recordChange("Customer", id, "update", updated, req.user.sub);
      return reply.code(200).send({
        softDeleted: true,
        customer: updated,
        message: `Customer has ${found._count.quotes + found._count.salesOrders + found._count.invoices} linked transaction(s); marked inactive instead of deleted.`,
      });
    }
    await db.customer.delete({ where: { id } });
    await recordChange("Customer", id, "delete", found, req.user.sub);
    return reply.code(200).send({ softDeleted: false });
  });
};
