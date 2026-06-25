// Channel mapping CRUD + bulk CSV import.
//
// External sales channels (DTDC shipping labels, marketplace exports,
// etc.) ship their own item codes that don't match our SKUs. This
// route exposes the translation table from Settings → Channel mappings
// so non-engineers can keep it current.
//
// Endpoints:
//   GET    /v1/channel-mappings?channel=&q=
//   POST   /v1/channel-mappings              { channel, externalCode, internalSku, notes? }
//   PATCH  /v1/channel-mappings/:id
//   DELETE /v1/channel-mappings/:id
//   POST   /v1/channel-mappings/import       { channel, rows: [{externalCode, internalSku, notes?}], replace? }
//   GET    /v1/channel-mappings/channels     → distinct channel list
//
// Each row records the channel name + the courier's item code + our
// internal SKU. internalSku is resolved against ProductVariant.sku
// first, then Product.sku as a fallback.

import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { db } from "../db.js";

const upsertBody = z.object({
  channel: z.string().trim().min(1).max(40),
  externalCode: z.string().trim().min(1).max(60),
  internalSku: z.string().trim().min(1).max(60),
  notes: z.string().trim().nullable().optional(),
  active: z.boolean().optional(),
});

const importBody = z.object({
  channel: z.string().trim().min(1).max(40),
  // `replace=true` wipes existing rows for the channel before insert —
  // useful when the operator pastes a fresh export. Default is "merge"
  // (upsert per row), which preserves any local edits.
  replace: z.boolean().optional(),
  rows: z
    .array(
      z.object({
        externalCode: z.string().trim().min(1).max(60),
        internalSku: z.string().trim().min(1).max(60),
        notes: z.string().trim().nullable().optional(),
      })
    )
    .min(1)
    .max(20_000),
});

// Resolves the right-hand column of a channel mapping (`internalSku`,
// historically) to an actual ProductVariant or Product in the catalog.
//
// Lookup order, first match wins:
//   1. ProductVariant.sku       (preferred — long SKU like AGRB-SAN-90STICKS-01)
//   2. ProductVariant.barcode   (short scan code like SM976, ML420 — common when
//                                the external system shipped its own short codes
//                                that we stamped on the variant barcode field)
//   3. Product.sku              (legacy — parent-product lookup)
//   4. Product.barcode          (parent-product short scan code)
//
// Returns `{ found: false }` for unknown codes so the bulk import can
// flag them without aborting the whole batch.
export const resolveInternalSku = async (
  code: string
): Promise<
  | { found: true; productId: string; variantId: string | null; productName: string }
  | { found: false }
> => {
  const variantBySku = await db.productVariant.findUnique({
    where: { sku: code },
    select: { id: true, productId: true, product: { select: { name: true } } },
  });
  if (variantBySku) {
    return {
      found: true,
      productId: variantBySku.productId,
      variantId: variantBySku.id,
      productName: variantBySku.product.name,
    };
  }
  const variantByBarcode = await db.productVariant.findUnique({
    where: { barcode: code },
    select: { id: true, productId: true, product: { select: { name: true } } },
  });
  if (variantByBarcode) {
    return {
      found: true,
      productId: variantByBarcode.productId,
      variantId: variantByBarcode.id,
      productName: variantByBarcode.product.name,
    };
  }
  const productBySku = await db.product.findFirst({
    where: { sku: code },
    select: { id: true, name: true },
  });
  if (productBySku) {
    return {
      found: true,
      productId: productBySku.id,
      variantId: null,
      productName: productBySku.name,
    };
  }
  const productByBarcode = await db.product.findFirst({
    where: { barcode: code },
    select: { id: true, name: true },
  });
  if (productByBarcode) {
    return {
      found: true,
      productId: productByBarcode.id,
      variantId: null,
      productName: productByBarcode.name,
    };
  }
  return { found: false };
};

export const channelMappingRoutes = async (app: FastifyInstance) => {
  app.get("/channel-mappings", { preHandler: [app.authenticate] }, async (req) => {
    const q = req.query as {
      channel?: string;
      q?: string;
      limit?: string;
      onlyUnresolved?: string;
    };
    const where: { channel?: string; OR?: unknown } = {};
    if (q.channel) where.channel = q.channel;
    if (q.q && q.q.trim()) {
      const term = q.q.trim();
      where.OR = [
        { externalCode: { contains: term } },
        { internalSku: { contains: term } },
        { notes: { contains: term } },
      ];
    }
    const rows = await db.channelMapping.findMany({
      where,
      orderBy: [{ channel: "asc" }, { externalCode: "asc" }],
      take: q.limit ? Math.max(1, Math.min(5000, parseInt(q.limit, 10))) : 1000,
    });
    // Enrich with product resolution so the UI can render the friendly
    // product name and flag unresolved rows in one shot. Match against
    // BOTH ProductVariant.sku/barcode AND Product.sku/barcode so the
    // table reflects what `resolveInternalSku` does at import time.
    const codes = [...new Set(rows.map((r) => r.internalSku))];
    const [vBySku, vByBarcode, pBySku, pByBarcode] = await Promise.all([
      db.productVariant.findMany({
        where: { sku: { in: codes } },
        select: { sku: true, product: { select: { name: true } } },
      }),
      db.productVariant.findMany({
        where: { barcode: { in: codes } },
        select: { barcode: true, product: { select: { name: true } } },
      }),
      db.product.findMany({
        where: { sku: { in: codes } },
        select: { sku: true, name: true },
      }),
      db.product.findMany({
        where: { barcode: { in: codes } },
        select: { barcode: true, name: true },
      }),
    ]);
    const nameMap = new Map<string, string>();
    for (const v of vBySku) nameMap.set(v.sku, v.product.name);
    for (const v of vByBarcode) {
      if (v.barcode && !nameMap.has(v.barcode)) nameMap.set(v.barcode, v.product.name);
    }
    for (const p of pBySku) if (!nameMap.has(p.sku)) nameMap.set(p.sku, p.name);
    for (const p of pByBarcode) {
      if (p.barcode && !nameMap.has(p.barcode)) nameMap.set(p.barcode, p.name);
    }
    const enriched = rows.map((r) => ({
      ...r,
      productName: nameMap.get(r.internalSku) ?? null,
      resolved: nameMap.has(r.internalSku),
    }));
    if (q.onlyUnresolved === "true") {
      return enriched.filter((r) => !r.resolved);
    }
    return enriched;
  });

  app.get("/channel-mappings/channels", { preHandler: [app.authenticate] }, async () => {
    const rows = await db.channelMapping.groupBy({
      by: ["channel"],
      _count: { _all: true },
      orderBy: { channel: "asc" },
    });
    return rows.map((r) => ({ channel: r.channel, count: r._count._all }));
  });

  app.post("/channel-mappings", { preHandler: [app.authenticate] }, async (req, reply) => {
    const body = upsertBody.parse(req.body);
    try {
      const created = await db.channelMapping.create({ data: body });
      return reply.code(201).send(created);
    } catch (e) {
      const err = e as { code?: string };
      if (err.code === "P2002") {
        return reply.code(409).send({
          error: {
            code: "duplicate",
            message: `Mapping for ${body.channel}/${body.externalCode} already exists.`,
          },
        });
      }
      throw e;
    }
  });

  app.patch("/channel-mappings/:id", { preHandler: [app.authenticate] }, async (req, reply) => {
    const id = (req.params as { id: string }).id;
    const body = upsertBody.partial().parse(req.body);
    const updated = await db.channelMapping
      .update({ where: { id }, data: body })
      .catch(() => null);
    if (!updated) return reply.code(404).send({ error: { code: "not_found" } });
    return updated;
  });

  app.delete("/channel-mappings/:id", { preHandler: [app.authenticate] }, async (req, reply) => {
    const id = (req.params as { id: string }).id;
    const r = await db.channelMapping.delete({ where: { id } }).catch(() => null);
    if (!r) return reply.code(404).send({ error: { code: "not_found" } });
    return { ok: true };
  });

  // Bulk upsert from a parsed CSV. Returns counts + a list of rows
  // whose internalSku does NOT resolve to a Product/Variant so the
  // operator can hunt down catalogue mismatches before importing
  // orders that rely on them.
  app.post("/channel-mappings/import", { preHandler: [app.authenticate] }, async (req) => {
    const body = importBody.parse(req.body);
    const channel = body.channel.trim();

    if (body.replace) {
      await db.channelMapping.deleteMany({ where: { channel } });
    }

    let created = 0;
    let updated = 0;
    let skipped = 0;
    const unresolved: { externalCode: string; internalSku: string }[] = [];

    // Process serially to keep memory bounded; SQLite is fine with this
    // for the typical 500-row catalogues.
    for (const row of body.rows) {
      const externalCode = row.externalCode.trim();
      const internalSku = row.internalSku.trim();
      if (!externalCode || !internalSku) {
        skipped += 1;
        continue;
      }
      // Track unresolved separately (but still upsert — operator may
      // be importing mappings ahead of catalogue work).
      const lookup = await resolveInternalSku(internalSku);
      if (!lookup.found) {
        unresolved.push({ externalCode, internalSku });
      }
      const existing = await db.channelMapping.findUnique({
        where: { channel_externalCode: { channel, externalCode } },
      });
      if (existing) {
        await db.channelMapping.update({
          where: { id: existing.id },
          data: {
            internalSku,
            notes: row.notes ?? existing.notes,
            active: true,
          },
        });
        updated += 1;
      } else {
        await db.channelMapping.create({
          data: {
            channel,
            externalCode,
            internalSku,
            notes: row.notes ?? null,
          },
        });
        created += 1;
      }
    }

    return {
      channel,
      total: body.rows.length,
      created,
      updated,
      skipped,
      unresolved,
    };
  });
};
