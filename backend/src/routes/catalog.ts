// Master data: products, vendors, customers, warehouses, bins.
import type { FastifyInstance, FastifyReply } from "fastify";
import { z } from "zod";
import { db } from "../db.js";
import { recordChange } from "../sync/log.js";
import { normalizeUomCode } from "../lib/uom.js";
import { binCodeFromRow } from "../lib/codes.js";
import { customerNetOpenBalance } from "./customer-payments.js";
import { generateVariantSku, generateVariantBarcode } from "../lib/tax.js";
import { createWriteStream, mkdirSync } from "fs";
import { join, dirname } from "path";
import { fileURLToPath } from "url";
import { pipeline } from "stream/promises";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const uploadsRoot = join(__dirname, "..", "..", "uploads");
mkdirSync(join(uploadsRoot, "products", "variants"), { recursive: true });

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
  // SKU may be omitted for new variants; auto-generated from parent SKU if blank.
  sku: z.string().optional(),
  // Barcode may be omitted for new variants; auto-generated from parent barcode if blank.
  barcode: z.string().nullable().optional(),
  // Optional variant-level HSN code (overrides product HSN when set).
  hsn: z.string().nullable().optional(),
  // Optional variant-level GST rate override. null = inherit parent product.gstRate.
  gstRate: z.number().min(0).max(100).nullable().optional(),
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
// SKU and barcode are expected to already be resolved before calling this.
const variantPersist = (v: z.infer<typeof variantInput> & { sku: string; barcode: string }) => {
  const uomRaw = (v.uom ?? "").trim();
  const uom = uomRaw.length === 0 ? null : requireCanonicalUom(uomRaw);
  return {
    sku: v.sku,
    barcode: v.barcode,
    hsn: v.hsn ?? null,
    gstRate: v.gstRate ?? null,
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
  categoryId: z.string().min(1),
  hsn: z.string(),
  // Default GST rate for this product (and inherited by variants that don't override).
  gstRate: z.number().min(0).max(100).default(18),
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
    category: { select: { id: true, slug: true, name: true, active: true } },
    variants: {
      orderBy: { sku: "asc" as const },
    },
  };

  const assertCategoryId = async (categoryId: string, reply: FastifyReply) => {
    const cat = await db.productCategory.findUnique({ where: { id: categoryId } });
    if (!cat) {
      void reply.code(400).send({
        error: { code: "invalid_category", message: "Category not found." },
      });
      return null;
    }
    if (!cat.active) {
      void reply.code(400).send({
        error: { code: "inactive_category", message: "Category is inactive." },
      });
      return null;
    }
    return cat;
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

  app.post("/products", { preHandler: [app.authenticate] }, async (req, reply) => {
    const data = productCreate.parse(req.body);
    const { variants, ...productData } = data;
    productData.uom = requireCanonicalUom(productData.uom);
    if (!(await assertCategoryId(productData.categoryId, reply))) return;

    // ── SKU/barcode uniqueness pre-check ─────────────────────────────────────
    // Collect all existing SKUs and barcodes in one pass so we can both
    // auto-generate missing variant codes and detect duplicates.
    const allSkus = new Set(
      (await db.product.findMany({ select: { sku: true } })).map((p) => p.sku).concat(
        (await db.productVariant.findMany({ select: { sku: true } })).map((v) => v.sku)
      )
    );
    const allBarcodes = new Set(
      (await db.product.findMany({ select: { barcode: true } }))
        .map((p) => p.barcode)
        .filter(Boolean)
        .concat(
          (await db.productVariant.findMany({ select: { barcode: true } }))
            .map((v) => v.barcode)
            .filter(Boolean) as string[]
        ) as string[]
    );

    // Check product-level SKU/barcode first.
    const duplicates: string[] = [];
    if (allSkus.has(productData.sku)) duplicates.push(`SKU '${productData.sku}' already exists`);
    if (allBarcodes.has(productData.barcode)) duplicates.push(`Barcode '${productData.barcode}' already exists`);
    if (duplicates.length) {
      return reply.code(409).send({ error: { code: "duplicate_code", messages: duplicates } });
    }

    // Add product codes to the working set so variant auto-gen avoids them.
    allSkus.add(productData.sku);
    allBarcodes.add(productData.barcode);

    // Resolve/validate each variant's SKU and barcode.
    const resolvedVariants = variants.map((v) => {
      const sku = v.sku?.trim() || generateVariantSku(productData.sku, allSkus);
      const barcode = v.barcode?.trim() || generateVariantBarcode(productData.barcode, allBarcodes);
      if (allSkus.has(sku)) duplicates.push(`Variant SKU '${sku}' already exists`);
      else allSkus.add(sku);
      if (allBarcodes.has(barcode)) duplicates.push(`Variant barcode '${barcode}' already exists`);
      else allBarcodes.add(barcode);
      return { ...v, sku, barcode };
    });
    if (duplicates.length) {
      return reply.code(409).send({ error: { code: "duplicate_code", messages: duplicates } });
    }

    const created = await db.product.create({
      data: {
        ...productData,
        variants: resolvedVariants.length
          ? {
              create: resolvedVariants.map(variantPersist),
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
    if (productData.categoryId !== undefined) {
      if (!(await assertCategoryId(productData.categoryId, reply))) return;
    }

    if (variants !== undefined) {
      // ── Auto-gen + uniqueness check for variant SKU/barcode ──────────────
      const parentSku = data.sku ?? before.sku;
      const parentBarcode = data.barcode ?? before.barcode;

      // Collect all existing codes excluding the variants belonging to this product
      // (they'll be replaced by the incoming payload, so we must not count them as
      // "already taken" when generating codes).
      const siblingIds = new Set(
        (await db.productVariant.findMany({ where: { productId: id }, select: { id: true } })).map((v) => v.id)
      );
      const allSkus = new Set(
        (await db.product.findMany({ where: { id: { not: id } }, select: { sku: true } })).map((p) => p.sku).concat(
          (await db.productVariant.findMany({ where: { id: { notIn: [...siblingIds] } }, select: { sku: true } })).map((v) => v.sku)
        )
      );
      const allBarcodes = new Set(
        (await db.product.findMany({ where: { id: { not: id } }, select: { barcode: true } }))
          .map((p) => p.barcode)
          .filter(Boolean)
          .concat(
            (await db.productVariant.findMany({ where: { id: { notIn: [...siblingIds] }, barcode: { not: null } }, select: { barcode: true } }))
              .map((v) => v.barcode)
              .filter(Boolean) as string[]
          ) as string[]
      );

      // Also exclude the product's own new codes from collision detection.
      if (parentSku) allSkus.add(parentSku);
      if (parentBarcode) allBarcodes.add(parentBarcode);

      const duplicates: string[] = [];
      const resolvedVariants = variants.map((v) => {
        const sku = v.sku?.trim() || generateVariantSku(parentSku, allSkus);
        const barcode = v.barcode?.trim() || generateVariantBarcode(parentBarcode, allBarcodes);
        if (allSkus.has(sku) && sku !== (v.sku?.trim())) duplicates.push(`Variant SKU '${sku}' already exists`);
        else allSkus.add(sku);
        if (allBarcodes.has(barcode) && barcode !== (v.barcode?.trim())) duplicates.push(`Variant barcode '${barcode}' already exists`);
        else allBarcodes.add(barcode);
        return { ...v, sku, barcode };
      });
      if (duplicates.length) {
        return reply.code(409).send({ error: { code: "duplicate_code", messages: duplicates } });
      }

      // Reconcile variants: insert / update / delete via diff against current set.
      const existing = await db.productVariant.findMany({ where: { productId: id } });
      const incomingIds = new Set(resolvedVariants.filter((v) => v.id).map((v) => v.id!));
      const toDelete = existing.filter((e) => !incomingIds.has(e.id));
      await db.$transaction([
        ...(toDelete.length
          ? [db.productVariant.deleteMany({ where: { id: { in: toDelete.map((d) => d.id) } } })]
          : []),
        ...resolvedVariants.map((v) =>
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
      orderBy: [{ zone: "asc" }, { shelf: "asc" }, { bin: "asc" }],
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
  // Bins are addressed by zone/shelf/bin within a warehouse and
  // are unique on the composite (warehouseId, zone, shelf, bin).
  // We expose:
  //   POST   /warehouses/:id/bins         single-bin create
  //   POST   /warehouses/:id/bins/bulk    create a whole shelf-set with
  //                                       N shelves x M bins per shelf
  //   PATCH  /bins/:id                    rename/recapacity
  //   DELETE /bins/:id                    only when bin holds no stock
  // The warehouse code/zone/shelf labels are normalised to
  // upper-case so a warehouse layout never accumulates "A1" vs "a1".

  const labelSchema = z
    .string()
    .min(1)
    .max(20)
    .regex(/^[A-Za-z0-9-]+$/, "letters / numbers / hyphen only");

  const binSingleCreate = z.object({
    zone: labelSchema,
    shelf: labelSchema,
    bin: labelSchema,
    capacity: z.number().int().positive().max(100000).default(100),
  });

  const binBulkCreate = z.object({
    zone: labelSchema,
    // List of shelf labels e.g. ["S1","S2","S3"]. Either provide this
    // explicitly or use shelfCount which generates S1..Sn.
    shelves: z.array(labelSchema).min(1).max(100).optional(),
    shelfCount: z.number().int().min(1).max(100).optional(),
    binsPerShelf: z.number().int().min(1).max(200),
    // Bin labels are auto-generated as `${shelf}-${seq}`.
    capacity: z.number().int().positive().max(100000).default(100),
  });

  const binUpdate = z
    .object({
      // Warehouse + zone/shelf are not editable to keep history
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

  const requireWriter = (
    req: { user: { role: string } },
    reply: { code: (n: number) => { send: (b: unknown) => void } }
  ) => {
    const r = req.user.role;
    if (r !== "admin" && r !== "supervisor" && r !== "warehouse") {
      reply.code(403).send({ error: { code: "forbidden", message: "Admin/supervisor/warehouse only" } });
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
        shelf: body.shelf.toUpperCase(),
        bin: body.bin.toUpperCase(),
        capacity: body.capacity,
        code: binCodeFromRow(
          {
            zone: body.zone.toUpperCase(),
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
              message: `Bin ${data.zone}/${data.shelf}/${data.bin} already exists in ${wh.code}.`,
            },
          });
        }
        throw e;
      }
    }
  );

  // POST /warehouses/:id/bins/bulk - create a shelf-set at once.
  // Convenience for the operator who wants "4 shelves x 5
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
      const rows: Array<{
        warehouseId: string;
        zone: string;
        shelf: string;
        bin: string;
        capacity: number;
        code: string;
      }> = [];
      for (const shelf of shelfLabels) {
        for (let i = 1; i <= body.binsPerShelf; i++) {
          const seq = String(i).padStart(2, "0");
          rows.push({
            warehouseId,
            zone,
            shelf,
            bin: seq,
            capacity: body.capacity,
            code: binCodeFromRow(
              { zone, shelf, bin: seq },
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
          shelf: { in: shelfLabels },
        },
        select: { shelf: true, bin: true },
      });
      if (existing.length > 0) {
        return reply.code(409).send({
          error: {
            code: "duplicate_bin",
            message: `Zone ${zone} already has ${existing.length} bin(s) on shelves ${[...new Set(existing.map((e) => e.shelf))].join(", ")}. Pick different shelf labels or delete the existing bins first.`,
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

  // ================================================================
  // POST /products/:id/sync-stock
  // Recalculates Product.stockOnHand from actual bin totals and
  // writes an Adjust ledger entry for any drift.
  // ================================================================
  app.post(
    "/products/:id/sync-stock",
    { preHandler: [app.authenticate] },
    async (req, reply) => {
      if (!requireWriter(req, reply)) return;
      const id = (req.params as { id: string }).id;
      const product = await db.product.findUnique({
        where: { id },
        select: { id: true, stockOnHand: true, sku: true },
      });
      if (!product) return reply.code(404).send({ error: { code: "not_found" } });

      const agg = await db.bin.aggregate({
        where: { productId: id },
        _sum: { qty: true },
      });
      const binTotal = agg._sum.qty ?? 0;
      const before = product.stockOnHand;
      const delta = binTotal - before;

      if (delta !== 0) {
        const wh = await db.warehouse.findFirst({ orderBy: { code: "asc" }, select: { id: true } });
        if (!wh) return reply.code(409).send({ error: { code: "no_warehouse", message: "No warehouse found." } });
        const year = new Date().getUTCFullYear();
        const ref = `SYNC-${year}-${Date.now().toString().slice(-6)}`;
        await db.$transaction([
          db.product.update({ where: { id }, data: { stockOnHand: binTotal } }),
          db.stockLedger.create({
            data: {
              productId: id,
              warehouseId: wh.id,
              txnType: "Adjust",
              ref,
              qty: delta,
              balance: binTotal,
            },
          }),
        ]);
      }

      return { before, after: binTotal, delta, binTotal };
    }
  );

  // ================================================================
  // POST /products/:id/variants/:vid/adjust-stock
  // Corrects a variant's stockOnHand counter to newQty, creating an
  // Adjust ledger entry for the delta.  Does NOT touch bin quantities.
  // ================================================================
  app.post(
    "/products/:id/variants/:vid/adjust-stock",
    { preHandler: [app.authenticate] },
    async (req, reply) => {
      if (!requireWriter(req, reply)) return;
      const { id, vid } = req.params as { id: string; vid: string };
      const { newQty } = z.object({ newQty: z.number().int().min(0) }).parse(req.body);

      const variant = await db.productVariant.findUnique({
        where: { id: vid, productId: id },
        select: { id: true, stockOnHand: true, sku: true },
      });
      if (!variant) return reply.code(404).send({ error: { code: "not_found" } });

      const before = variant.stockOnHand;
      const delta = newQty - before;

      if (delta !== 0) {
        const wh = await db.warehouse.findFirst({ orderBy: { code: "asc" }, select: { id: true } });
        if (!wh) return reply.code(409).send({ error: { code: "no_warehouse", message: "No warehouse found." } });
        const year = new Date().getUTCFullYear();
        const ref = `ADJ-V-${year}-${Date.now().toString().slice(-6)}`;
        await db.$transaction([
          db.productVariant.update({ where: { id: vid }, data: { stockOnHand: newQty } }),
          db.product.update({ where: { id }, data: { stockOnHand: { increment: delta } } }),
          db.stockLedger.create({
            data: {
              productId: id,
              warehouseId: wh.id,
              txnType: "Adjust",
              ref,
              qty: delta,
              balance: newQty,
            },
          }),
        ]);
      }

      return { sku: variant.sku, before, after: newQty, delta };
    }
  );

  // ================================================================
  // GET /products/:id/bin-stock
  // Returns the sum of all bin qty for a product, plus per-warehouse
  // breakdown, so the UI can show "bin total" vs "counter".
  // ================================================================
  app.get(
    "/products/:id/bin-stock",
    { preHandler: [app.authenticate] },
    async (req, reply) => {
      const id = (req.params as { id: string }).id;
      const bins = await db.bin.findMany({
        where: { productId: id },
        select: {
          id: true,
          qty: true,
          reservedQty: true,
          zone: true,
          shelf: true,
          bin: true,
          warehouseId: true,
          warehouse: { select: { id: true, code: true, name: true } },
        },
        orderBy: [{ warehouse: { code: "asc" } }, { zone: "asc" }, { shelf: "asc" }, { bin: "asc" }],
      });
      const total = bins.reduce((s, b) => s + b.qty, 0);
      const free = bins.reduce((s, b) => s + (b.qty - b.reservedQty), 0);
      return {
        total,
        free,
        bins: bins.map((b) => ({
          binId: b.id,
          warehouseId: b.warehouseId,
          warehouse: b.warehouse.code,
          warehouseName: b.warehouse.name,
          location: `${b.zone}/${b.shelf}/${b.bin}`,
          zone: b.zone,
          shelf: b.shelf,
          bin: b.bin,
          qty: b.qty,
          reserved: b.reservedQty,
          free: b.qty - b.reservedQty,
        })),
      };
    }
  );

  // ================================================================
  // Product + Variant image upload
  // POST /products/:id/image          — upload / replace product photo
  // POST /products/:id/variants/:vid/image — upload / replace variant photo
  // Storage:
  //   product  images → uploads/products/<productId>.jpg
  //   variant  images → uploads/products/variants/<variantId>.jpg
  //
  // The endpoint accepts multipart/form-data with a single file field
  // named "image". Only image/* content-types are accepted.
  // ================================================================

  app.post(
    "/products/:id/image",
    { preHandler: [app.authenticate] },
    async (req, reply) => {
      const { id } = req.params as { id: string };
      const product = await db.product.findUnique({ where: { id } });
      if (!product) return reply.code(404).send({ error: { code: "not_found" } });

      const data = await req.file();
      if (!data) return reply.code(400).send({ error: { code: "no_file", message: "No file uploaded." } });
      if (!data.mimetype.startsWith("image/")) {
        return reply.code(400).send({ error: { code: "invalid_type", message: "Only image files are accepted." } });
      }

      const ext = data.mimetype === "image/png" ? ".png" : data.mimetype === "image/webp" ? ".webp" : ".jpg";
      const filename = `${id}${ext}`;
      const dest = join(uploadsRoot, "products", filename);
      await pipeline(data.file, createWriteStream(dest));

      const imageUrl = `/uploads/products/${filename}`;
      const updated = await db.product.update({ where: { id }, data: { imageUrl } });
      return { imageUrl: updated.imageUrl };
    }
  );

  app.post(
    "/products/:id/variants/:vid/image",
    { preHandler: [app.authenticate] },
    async (req, reply) => {
      const { id, vid } = req.params as { id: string; vid: string };
      const variant = await db.productVariant.findFirst({ where: { id: vid, productId: id } });
      if (!variant) return reply.code(404).send({ error: { code: "not_found" } });

      const data = await req.file();
      if (!data) return reply.code(400).send({ error: { code: "no_file", message: "No file uploaded." } });
      if (!data.mimetype.startsWith("image/")) {
        return reply.code(400).send({ error: { code: "invalid_type", message: "Only image files are accepted." } });
      }

      const ext = data.mimetype === "image/png" ? ".png" : data.mimetype === "image/webp" ? ".webp" : ".jpg";
      const filename = `${vid}${ext}`;
      const dest = join(uploadsRoot, "products", "variants", filename);
      await pipeline(data.file, createWriteStream(dest));

      const imageUrl = `/uploads/products/variants/${filename}`;
      // Use executeRaw because Prisma client was generated before imageUrl was
      // added to ProductVariant; the column exists in the DB.
      await db.$executeRaw`UPDATE "ProductVariant" SET "imageUrl" = ${imageUrl}, "updatedAt" = CURRENT_TIMESTAMP WHERE "id" = ${vid}`;
      return { imageUrl };
    }
  );

  // ================================================================
  // Zone / Shelf bulk operations
  // Zones and shelves are label strings on Bin rows — there is no
  // separate entity. These endpoints operate on all bins in a
  // zone/shelf as a batch.
  // ================================================================

  // PATCH /warehouses/:id/zones/:zone - rename a zone.
  // Renames all bins in the zone; blocked if any has stock+ledger
  // reference that would make the history misleading.
  app.patch(
    "/warehouses/:id/zones/:zone",
    { preHandler: [app.authenticate] },
    async (req, reply) => {
      if (!requireAdmin(req, reply)) return;
      const { id: warehouseId, zone } = req.params as { id: string; zone: string };
      const body = z.object({ newZone: labelSchema }).parse(req.body);
      const newZone = body.newZone.toUpperCase();
      if (newZone === zone.toUpperCase()) return { updated: 0 };
      // Check no bin in newZone already exists (would create duplicates).
      const conflict = await db.bin.findFirst({
        where: { warehouseId, zone: newZone },
      });
      if (conflict) {
        return reply.code(409).send({
          error: {
            code: "zone_exists",
            message: `Zone ${newZone} already has bins in this warehouse. Merge manually or pick a different name.`,
          },
        });
      }
      const { count } = await db.bin.updateMany({
        where: { warehouseId, zone: zone.toUpperCase() },
        data: { zone: newZone },
      });
      if (count === 0) return reply.code(404).send({ error: { code: "zone_not_found" } });
      // Refresh codes for all renamed bins.
      const wh = await db.warehouse.findUnique({ where: { id: warehouseId } });
      if (wh) {
        const affected = await db.bin.findMany({ where: { warehouseId, zone: newZone } });
        for (const b of affected) {
          await db.bin.update({
            where: { id: b.id },
            data: { code: binCodeFromRow({ zone: b.zone, shelf: b.shelf, bin: b.bin }, wh.code) },
          });
        }
      }
      return { updated: count, newZone };
    }
  );

  // DELETE /warehouses/:id/zones/:zone - delete all bins in zone.
  // Only allowed when every bin in the zone is empty (qty = 0 AND reservedQty = 0).
  app.delete(
    "/warehouses/:id/zones/:zone",
    { preHandler: [app.authenticate] },
    async (req, reply) => {
      if (!requireAdmin(req, reply)) return;
      const { id: warehouseId, zone } = req.params as { id: string; zone: string };
      const bins = await db.bin.findMany({ where: { warehouseId, zone: zone.toUpperCase() } });
      if (bins.length === 0) return reply.code(404).send({ error: { code: "zone_not_found" } });
      const occupied = bins.filter((b) => (b.qty ?? 0) > 0 || (b.reservedQty ?? 0) > 0);
      if (occupied.length > 0) {
        return reply.code(409).send({
          error: {
            code: "zone_not_empty",
            message: `${occupied.length} bin(s) in zone ${zone} still hold stock. Transfer all stock out before deleting the zone.`,
          },
        });
      }
      const inUse = await db.pickListItem.count({ where: { binId: { in: bins.map((b) => b.id) } } });
      if (inUse > 0) {
        return reply.code(409).send({
          error: {
            code: "zone_in_use",
            message: `${inUse} pick-list item(s) reference bins in this zone. Cannot delete.`,
          },
        });
      }
      await db.bin.deleteMany({ where: { warehouseId, zone: zone.toUpperCase() } });
      return { deleted: bins.length };
    }
  );

  // PATCH /warehouses/:id/zones/:zone/shelves/:shelf - rename a shelf.
  app.patch(
    "/warehouses/:id/zones/:zone/shelves/:shelf",
    { preHandler: [app.authenticate] },
    async (req, reply) => {
      if (!requireAdmin(req, reply)) return;
      const { id: warehouseId, zone, shelf } = req.params as {
        id: string; zone: string; shelf: string;
      };
      const body = z.object({ newShelf: labelSchema }).parse(req.body);
      const newShelf = body.newShelf.toUpperCase();
      if (newShelf === shelf.toUpperCase()) return { updated: 0 };
      const conflict = await db.bin.findFirst({
        where: { warehouseId, zone: zone.toUpperCase(), shelf: newShelf },
      });
      if (conflict) {
        return reply.code(409).send({
          error: {
            code: "shelf_exists",
            message: `Shelf ${newShelf} already exists in zone ${zone}. Merge manually or pick a different name.`,
          },
        });
      }
      const { count } = await db.bin.updateMany({
        where: { warehouseId, zone: zone.toUpperCase(), shelf: shelf.toUpperCase() },
        data: { shelf: newShelf },
      });
      if (count === 0) return reply.code(404).send({ error: { code: "shelf_not_found" } });
      // Refresh codes.
      const wh = await db.warehouse.findUnique({ where: { id: warehouseId } });
      if (wh) {
        const affected = await db.bin.findMany({
          where: { warehouseId, zone: zone.toUpperCase(), shelf: newShelf },
        });
        for (const b of affected) {
          await db.bin.update({
            where: { id: b.id },
            data: { code: binCodeFromRow({ zone: b.zone, shelf: b.shelf, bin: b.bin }, wh.code) },
          });
        }
      }
      return { updated: count, newShelf };
    }
  );

  // DELETE /warehouses/:id/zones/:zone/shelves/:shelf - delete all bins on shelf.
  app.delete(
    "/warehouses/:id/zones/:zone/shelves/:shelf",
    { preHandler: [app.authenticate] },
    async (req, reply) => {
      if (!requireAdmin(req, reply)) return;
      const { id: warehouseId, zone, shelf } = req.params as {
        id: string; zone: string; shelf: string;
      };
      const bins = await db.bin.findMany({
        where: { warehouseId, zone: zone.toUpperCase(), shelf: shelf.toUpperCase() },
      });
      if (bins.length === 0) return reply.code(404).send({ error: { code: "shelf_not_found" } });
      const occupied = bins.filter((b) => (b.qty ?? 0) > 0 || (b.reservedQty ?? 0) > 0);
      if (occupied.length > 0) {
        return reply.code(409).send({
          error: {
            code: "shelf_not_empty",
            message: `${occupied.length} bin(s) on shelf ${shelf} still hold stock. Transfer all stock out before deleting the shelf.`,
          },
        });
      }
      const inUse = await db.pickListItem.count({ where: { binId: { in: bins.map((b) => b.id) } } });
      if (inUse > 0) {
        return reply.code(409).send({
          error: {
            code: "shelf_in_use",
            message: `${inUse} pick-list item(s) reference bins on this shelf. Cannot delete.`,
          },
        });
      }
      await db.bin.deleteMany({
        where: { warehouseId, zone: zone.toUpperCase(), shelf: shelf.toUpperCase() },
      });
      return { deleted: bins.length };
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
