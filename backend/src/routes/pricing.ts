// Dynamic pricing: PriceList CRUD + the resolver everyone uses.
//
// resolveEffectivePrice() is THE single source of truth for what a
// customer is charged for a SKU at a given qty. Everything that mints a
// price (POS, quotes, sales orders, packing-slip invoicing) should call
// it server-side so prices are consistent no matter the entry point.

import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { db } from "../db.js";
import { recordChange } from "../sync/log.js";

// =============================================================== Resolver ===
//
// Waterfall:
//   1. PriceListItem override on (customer.priceList, product, variant)
//      pick the row with the largest minQty <= requested qty.
//      A row with variantId=null also matches a variant SKU as a fallback.
//   2. List-wide formula: basis * multiplier, basis from Product.{sellingPrice,costPrice}
//   3. Product/variant default sellingPrice
//
// Returns the resolved price + the origin so the UI can display chips.

export type PriceOrigin =
  | "list_override_tier"
  | "list_override"
  | "list_formula"
  | "variant_override"
  | "product_default";

export interface ResolvedPrice {
  price: number;
  origin: PriceOrigin;
  priceListCode?: string;
  minQty?: number; // for tier overrides
  multiplier?: number; // for formula
  basisPrice?: number; // the upstream value used by the formula
}

export const resolveEffectivePrice = async (input: {
  productId: string;
  variantId?: string | null;
  customerId?: string | null;
  qty: number;
}): Promise<ResolvedPrice> => {
  const qty = Math.max(1, input.qty);
  const product = await db.product.findUnique({
    where: { id: input.productId },
    select: { id: true, sellingPrice: true, costPrice: true },
  });
  if (!product) {
    throw new Error(`Product ${input.productId} not found`);
  }

  let variantOverride: number | null = null;
  if (input.variantId) {
    const v = await db.productVariant.findUnique({
      where: { id: input.variantId },
      select: { sellingPriceOverride: true },
    });
    variantOverride = v?.sellingPriceOverride ?? null;
  }

  // No customer or no list assigned => fall through to defaults.
  let priceList: {
    id: string;
    code: string;
    basis: string;
    multiplier: number;
    active: boolean;
    validFrom: Date | null;
    validUntil: Date | null;
  } | null = null;
  if (input.customerId) {
    const cust = await db.customer.findUnique({
      where: { id: input.customerId },
      select: {
        priceList: {
          select: {
            id: true,
            code: true,
            basis: true,
            multiplier: true,
            active: true,
            validFrom: true,
            validUntil: true,
          },
        },
      },
    });
    priceList = cust?.priceList ?? null;
  }
  // Only honor the price list if active and within validity window.
  const now = new Date();
  if (
    priceList &&
    (!priceList.active ||
      (priceList.validFrom && priceList.validFrom > now) ||
      (priceList.validUntil && priceList.validUntil < now))
  ) {
    priceList = null;
  }

  if (priceList) {
    // 1. Look for explicit override rows. Prefer exact variant match;
    //    fall back to variantId=null. Within matches, pick the highest
    //    minQty that is still <= qty.
    const candidates = await db.priceListItem.findMany({
      where: {
        priceListId: priceList.id,
        productId: input.productId,
        minQty: { lte: qty },
        OR: [
          ...(input.variantId ? [{ variantId: input.variantId }] : []),
          { variantId: null },
        ],
      },
      orderBy: [
        // Variant-specific overrides outrank parent-level overrides
        { variantId: "desc" },
        { minQty: "desc" },
      ],
    });
    if (candidates.length > 0) {
      const best = candidates[0];
      return {
        price: best.price,
        origin: best.minQty > 1 ? "list_override_tier" : "list_override",
        priceListCode: priceList.code,
        minQty: best.minQty,
      };
    }

    // 2. List-wide formula
    const basisPrice =
      priceList.basis === "cost" ? product.costPrice : product.sellingPrice;
    return {
      price: Math.round(basisPrice * priceList.multiplier * 100) / 100,
      origin: "list_formula",
      priceListCode: priceList.code,
      multiplier: priceList.multiplier,
      basisPrice,
    };
  }

  // 3. Variant override (non-list path)
  if (variantOverride != null) {
    return { price: variantOverride, origin: "variant_override" };
  }
  // 4. Product default
  return { price: product.sellingPrice, origin: "product_default" };
};

// =================================================================== Routes ===

export const pricingRoutes = async (app: FastifyInstance) => {
  // ----------------------------------------------- Price Lists CRUD ---

  app.get("/price-lists", async () =>
    db.priceList.findMany({
      orderBy: [{ isDefault: "desc" }, { code: "asc" }],
      include: {
        _count: { select: { items: true, customers: true } },
      },
    })
  );

  app.get("/price-lists/:id", async (req, reply) => {
    const id = (req.params as { id: string }).id;
    const pl = await db.priceList.findUnique({
      where: { id },
      include: {
        items: {
          include: {
            product: { select: { id: true, sku: true, name: true, sellingPrice: true, costPrice: true, uom: true } },
            variant: { select: { id: true, sku: true, size: true, color: true, grade: true } },
          },
          orderBy: [{ productId: "asc" }, { minQty: "asc" }],
        },
        customers: { select: { id: true, code: true, name: true } },
      },
    });
    if (!pl) return reply.code(404).send({ error: { code: "not_found" } });
    return pl;
  });

  const upsertSchema = z.object({
    code: z.string().min(2).max(40),
    name: z.string().min(1),
    description: z.string().nullable().optional(),
    currency: z.string().default("INR"),
    basis: z.enum(["selling", "cost"]).default("selling"),
    multiplier: z.number().positive().default(1.0),
    active: z.boolean().default(true),
    isDefault: z.boolean().default(false),
    validFrom: z.string().datetime().nullable().optional(),
    validUntil: z.string().datetime().nullable().optional(),
  });

  app.post("/price-lists", { preHandler: [app.authenticate] }, async (req, reply) => {
    const body = upsertSchema.parse(req.body);
    if (body.isDefault) {
      await db.priceList.updateMany({ where: { isDefault: true }, data: { isDefault: false } });
    }
    try {
      const created = await db.priceList.create({
        data: {
          ...body,
          validFrom: body.validFrom ? new Date(body.validFrom) : null,
          validUntil: body.validUntil ? new Date(body.validUntil) : null,
        },
      });
      await recordChange("PriceList", created.id, "insert", created, req.user.sub);
      return created;
    } catch (e) {
      const err = e as { code?: string };
      if (err.code === "P2002") {
        return reply.code(409).send({ error: { code: "duplicate_code", message: "Price-list code already exists" } });
      }
      throw e;
    }
  });

  app.patch("/price-lists/:id", { preHandler: [app.authenticate] }, async (req, reply) => {
    const id = (req.params as { id: string }).id;
    const body = upsertSchema.partial().parse(req.body);
    if (body.isDefault) {
      await db.priceList.updateMany({ where: { isDefault: true, NOT: { id } }, data: { isDefault: false } });
    }
    const updated = await db.priceList.update({
      where: { id },
      data: {
        ...body,
        validFrom: body.validFrom === undefined ? undefined : body.validFrom ? new Date(body.validFrom) : null,
        validUntil: body.validUntil === undefined ? undefined : body.validUntil ? new Date(body.validUntil) : null,
      },
    });
    await recordChange("PriceList", id, "update", updated, req.user.sub);
    return updated;
  });

  app.delete("/price-lists/:id", { preHandler: [app.authenticate] }, async (req, reply) => {
    const id = (req.params as { id: string }).id;
    const customers = await db.customer.count({ where: { priceListId: id } });
    if (customers > 0) {
      return reply.code(409).send({
        error: { code: "in_use", message: `${customers} customer(s) still reference this list. Reassign them first.` },
      });
    }
    await db.priceList.delete({ where: { id } });
    await recordChange("PriceList", id, "delete", { id }, req.user.sub);
    return { ok: true };
  });

  // ------------------------------------------ Price List items (bulk) ---
  //
  // PATCH /price-lists/:id/items
  // Body: { upsert: [{productId, variantId?, price, minQty?, notes?}],
  //         remove: [itemId] }
  // This is the bulk operation the "price book" UI uses; a single call
  // updates many SKUs at once.

  const bulkSchema = z.object({
    upsert: z
      .array(
        z.object({
          id: z.string().optional(),
          productId: z.string(),
          variantId: z.string().nullable().optional(),
          price: z.number().nonnegative(),
          minQty: z.number().positive().default(1),
          notes: z.string().nullable().optional(),
        })
      )
      .optional(),
    remove: z.array(z.string()).optional(),
  });

  app.patch("/price-lists/:id/items", { preHandler: [app.authenticate] }, async (req, reply) => {
    const id = (req.params as { id: string }).id;
    const body = bulkSchema.parse(req.body);
    const pl = await db.priceList.findUnique({ where: { id } });
    if (!pl) return reply.code(404).send({ error: { code: "not_found" } });

    if (body.remove?.length) {
      await db.priceListItem.deleteMany({
        where: { id: { in: body.remove }, priceListId: id },
      });
    }
    for (const item of body.upsert ?? []) {
      if (item.id) {
        await db.priceListItem.update({
          where: { id: item.id },
          data: {
            price: item.price,
            minQty: item.minQty,
            notes: item.notes ?? null,
          },
        });
      } else {
        // Manual upsert because Prisma's composite-unique where doesn't
        // accept a nullable variantId in its type.
        const existing = await db.priceListItem.findFirst({
          where: {
            priceListId: id,
            productId: item.productId,
            variantId: item.variantId ?? null,
            minQty: item.minQty,
          },
        });
        if (existing) {
          await db.priceListItem.update({
            where: { id: existing.id },
            data: { price: item.price, notes: item.notes ?? null },
          });
        } else {
          await db.priceListItem.create({
            data: {
              priceListId: id,
              productId: item.productId,
              variantId: item.variantId ?? null,
              price: item.price,
              minQty: item.minQty,
              notes: item.notes ?? null,
            },
          });
        }
      }
    }
    const fresh = await db.priceList.findUnique({
      where: { id },
      include: {
        items: {
          include: {
            product: { select: { id: true, sku: true, name: true, sellingPrice: true } },
            variant: { select: { id: true, sku: true, size: true, color: true } },
          },
          orderBy: [{ productId: "asc" }, { minQty: "asc" }],
        },
      },
    });
    await recordChange("PriceList", id, "update", fresh, req.user.sub);
    return fresh;
  });

  // "Apply formula" bulk operation: rewrites every product's base
  // (minQty=1) override price to `basis * multiplier`. Lets ops apply a
  // global "20% off MRP" in one click.
  app.post(
    "/price-lists/:id/apply-formula",
    { preHandler: [app.authenticate] },
    async (req, reply) => {
      const id = (req.params as { id: string }).id;
      const body = z
        .object({
          basis: z.enum(["selling", "cost"]).default("selling"),
          multiplier: z.number().positive(),
          // Only rewrites rows that already exist; pass true to also
          // create rows for every active product.
          createMissing: z.boolean().default(false),
        })
        .parse(req.body);
      const pl = await db.priceList.findUnique({ where: { id } });
      if (!pl) return reply.code(404).send({ error: { code: "not_found" } });

      const products = await db.product.findMany({
        where: { state: "active" },
        select: { id: true, sellingPrice: true, costPrice: true },
      });
      let written = 0;
      for (const p of products) {
        const basisPrice = body.basis === "cost" ? p.costPrice : p.sellingPrice;
        const newPrice = Math.round(basisPrice * body.multiplier * 100) / 100;
        const existing = await db.priceListItem.findFirst({
          where: {
            priceListId: id,
            productId: p.id,
            variantId: null,
            minQty: 1,
          },
        });
        if (existing) {
          await db.priceListItem.update({
            where: { id: existing.id },
            data: { price: newPrice },
          });
          written++;
        } else if (body.createMissing) {
          await db.priceListItem.create({
            data: {
              priceListId: id,
              productId: p.id,
              variantId: null,
              price: newPrice,
              minQty: 1,
            },
          });
          written++;
        }
      }
      // Also stamp the formula on the price list itself
      await db.priceList.update({
        where: { id },
        data: { basis: body.basis, multiplier: body.multiplier },
      });
      return { ok: true, written };
    }
  );

  // ---------------------------------------------- Resolver endpoint ---

  app.get("/pricing/resolve", async (req, reply) => {
    const q = (req.query ?? {}) as Record<string, string>;
    if (!q.productId) {
      return reply.code(400).send({ error: { code: "missing_product" } });
    }
    const qty = Number(q.qty ?? "1");
    return resolveEffectivePrice({
      productId: q.productId,
      variantId: q.variantId || null,
      customerId: q.customerId || null,
      qty: Number.isFinite(qty) && qty > 0 ? qty : 1,
    });
  });

  // Bulk resolver: useful for the quote/SO editor to price every line.
  // Body: { customerId?, items: [{productId, variantId?, qty}] }
  app.post("/pricing/resolve-many", async (req, reply) => {
    const body = z
      .object({
        customerId: z.string().nullable().optional(),
        items: z.array(
          z.object({
            productId: z.string(),
            variantId: z.string().nullable().optional(),
            qty: z.number().positive().default(1),
          })
        ),
      })
      .parse(req.body);
    try {
      const out = await Promise.all(
        body.items.map((it) =>
          resolveEffectivePrice({
            productId: it.productId,
            variantId: it.variantId ?? null,
            customerId: body.customerId ?? null,
            qty: it.qty,
          })
        )
      );
      return out;
    } catch (e) {
      return reply.code(400).send({ error: { code: "resolve_failed", message: (e as Error).message } });
    }
  });
};
