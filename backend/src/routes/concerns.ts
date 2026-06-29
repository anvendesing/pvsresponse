// Product concern master data (storefront "Shop by Concern" + ERP multi-select).
import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import { z } from "zod";
import { createWriteStream, mkdirSync } from "fs";
import { join, dirname } from "path";
import { fileURLToPath } from "url";
import { pipeline } from "stream/promises";
import { db } from "../db.js";
import { recordChange } from "../sync/log.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const uploadsRoot = join(__dirname, "..", "..", "uploads");
mkdirSync(join(uploadsRoot, "concerns"), { recursive: true });

const slugSchema = z
  .string()
  .min(1)
  .max(60)
  .regex(/^[a-z0-9-]+$/, "lowercase letters, numbers, hyphen only");

const concernCreate = z.object({
  slug: slugSchema,
  name: z.string().min(1).max(120),
  description: z.string().max(2000).nullable().optional(),
  icon: z.string().max(40).nullable().optional(),
  sortOrder: z.number().int().min(0).max(9999).default(0),
  active: z.boolean().default(true),
});

const concernUpdate = concernCreate.partial();

const requireAdmin = (req: FastifyRequest, reply: FastifyReply): boolean => {
  if (!req.user) {
    void reply.code(401).send({ error: { code: "unauthorized" } });
    return false;
  }
  if (req.user.role !== "admin" && req.user.role !== "supervisor") {
    void reply.code(403).send({ error: { code: "forbidden" } });
    return false;
  }
  return true;
};

const concernSelect = {
  id: true,
  slug: true,
  name: true,
  description: true,
  icon: true,
  sortOrder: true,
  active: true,
  imageUrl: true,
  createdAt: true,
  updatedAt: true,
  _count: { select: { products: true } },
} as const;

export const concernsRoutes = async (app: FastifyInstance) => {
  app.get("/concerns", async (req) => {
    const q = (req.query as Record<string, string>) ?? {};
    const activeOnly = q.active === "1" || q.active === "true";
    return db.productConcern.findMany({
      where: activeOnly ? { active: true } : {},
      orderBy: [{ sortOrder: "asc" }, { name: "asc" }],
      select: {
        id: true,
        slug: true,
        name: true,
        description: true,
        icon: true,
        sortOrder: true,
        active: true,
        imageUrl: true,
      },
    });
  });

  app.get(
    "/concerns/:id",
    { preHandler: [app.authenticate] },
    async (req, reply) => {
      const id = (req.params as { id: string }).id;
      const row = await db.productConcern.findFirst({
        where: { OR: [{ id }, { slug: id }] },
        select: concernSelect,
      });
      if (!row) return reply.code(404).send({ error: { code: "not_found" } });
      return row;
    }
  );

  app.post(
    "/concerns",
    { preHandler: [app.authenticate] },
    async (req, reply) => {
      if (!requireAdmin(req, reply)) return;
      const data = concernCreate.parse(req.body);
      const slug = data.slug.toLowerCase();
      const existing = await db.productConcern.findUnique({ where: { slug } });
      if (existing) {
        return reply.code(409).send({
          error: { code: "slug_exists", message: `Concern slug '${slug}' already exists.` },
        });
      }
      const created = await db.productConcern.create({
        data: { ...data, slug, description: data.description ?? null, icon: data.icon ?? null },
        select: concernSelect,
      });
      await recordChange("ProductConcern" as never, created.id, "insert", created, req.user!.sub);
      return created;
    }
  );

  app.patch(
    "/concerns/:id",
    { preHandler: [app.authenticate] },
    async (req, reply) => {
      if (!requireAdmin(req, reply)) return;
      const id = (req.params as { id: string }).id;
      const data = concernUpdate.parse(req.body);
      const before = await db.productConcern.findFirst({
        where: { OR: [{ id }, { slug: id }] },
      });
      if (!before) return reply.code(404).send({ error: { code: "not_found" } });

      if (data.slug && data.slug.toLowerCase() !== before.slug) {
        const conflict = await db.productConcern.findUnique({
          where: { slug: data.slug.toLowerCase() },
        });
        if (conflict && conflict.id !== before.id) {
          return reply.code(409).send({
            error: { code: "slug_exists", message: `Slug '${data.slug}' is already in use.` },
          });
        }
      }

      const updated = await db.productConcern.update({
        where: { id: before.id },
        data: {
          ...(data.name !== undefined ? { name: data.name } : {}),
          ...(data.slug !== undefined ? { slug: data.slug.toLowerCase() } : {}),
          ...(data.description !== undefined ? { description: data.description } : {}),
          ...(data.icon !== undefined ? { icon: data.icon } : {}),
          ...(data.sortOrder !== undefined ? { sortOrder: data.sortOrder } : {}),
          ...(data.active !== undefined ? { active: data.active } : {}),
        },
        select: concernSelect,
      });
      await recordChange("ProductConcern" as never, before.id, "update", updated, req.user!.sub);
      return updated;
    }
  );

  app.delete(
    "/concerns/:id",
    { preHandler: [app.authenticate] },
    async (req, reply) => {
      if (!requireAdmin(req, reply)) return;
      const id = (req.params as { id: string }).id;
      const row = await db.productConcern.findFirst({
        where: { OR: [{ id }, { slug: id }] },
        include: { _count: { select: { products: true } } },
      });
      if (!row) return reply.code(404).send({ error: { code: "not_found" } });
      await db.productConcern.delete({ where: { id: row.id } });
      await recordChange("ProductConcern" as never, row.id, "delete", row, req.user!.sub);
      return { deleted: true };
    }
  );

  app.post(
    "/concerns/:id/image",
    { preHandler: [app.authenticate] },
    async (req, reply) => {
      if (!requireAdmin(req, reply)) return;
      const id = (req.params as { id: string }).id;
      const row = await db.productConcern.findFirst({
        where: { OR: [{ id }, { slug: id }] },
      });
      if (!row) return reply.code(404).send({ error: { code: "not_found" } });

      const data = await req.file();
      if (!data) {
        return reply.code(400).send({ error: { code: "no_file", message: "No file uploaded." } });
      }
      if (!data.mimetype.startsWith("image/")) {
        return reply.code(400).send({
          error: { code: "invalid_type", message: "Only image files are accepted." },
        });
      }

      const ext =
        data.mimetype === "image/png"
          ? ".png"
          : data.mimetype === "image/webp"
            ? ".webp"
            : ".jpg";
      const filename = `${row.id}${ext}`;
      const dest = join(uploadsRoot, "concerns", filename);
      await pipeline(data.file, createWriteStream(dest));

      const imageUrl = `/uploads/concerns/${filename}`;
      const updated = await db.productConcern.update({
        where: { id: row.id },
        data: { imageUrl },
        select: { id: true, imageUrl: true },
      });
      return updated;
    }
  );
};
