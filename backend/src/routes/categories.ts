// Product category master data (storefront + ERP product assignment).
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
mkdirSync(join(uploadsRoot, "categories"), { recursive: true });

const slugSchema = z
  .string()
  .min(1)
  .max(40)
  .regex(/^[a-z0-9-]+$/, "lowercase letters, numbers, hyphen only");

const categoryCreate = z.object({
  slug: slugSchema,
  name: z.string().min(1).max(120),
  sortOrder: z.number().int().min(0).max(9999).default(0),
  active: z.boolean().default(true),
});

const categoryUpdate = categoryCreate.partial();

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

const categorySelect = {
  id: true,
  slug: true,
  name: true,
  sortOrder: true,
  active: true,
  imageUrl: true,
  createdAt: true,
  updatedAt: true,
  _count: { select: { products: true } },
} as const;

export const categoriesRoutes = async (app: FastifyInstance) => {
  // GET /categories — public list for storefront + ERP dropdowns
  app.get("/categories", async (req) => {
    const q = (req.query as Record<string, string>) ?? {};
    const activeOnly = q.active === "1" || q.active === "true";
    return db.productCategory.findMany({
      where: activeOnly ? { active: true } : {},
      orderBy: [{ sortOrder: "asc" }, { name: "asc" }],
      select: {
        id: true,
        slug: true,
        name: true,
        sortOrder: true,
        active: true,
        imageUrl: true,
        updatedAt: true,
      },
    });
  });

  app.get(
    "/categories/:id",
    { preHandler: [app.authenticate] },
    async (req, reply) => {
      const id = (req.params as { id: string }).id;
      const row = await db.productCategory.findFirst({
        where: { OR: [{ id }, { slug: id }] },
        select: categorySelect,
      });
      if (!row) return reply.code(404).send({ error: { code: "not_found" } });
      return row;
    }
  );

  app.post(
    "/categories",
    { preHandler: [app.authenticate] },
    async (req, reply) => {
      if (!requireAdmin(req, reply)) return;
      const data = categoryCreate.parse(req.body);
      const slug = data.slug.toLowerCase();
      const existing = await db.productCategory.findUnique({ where: { slug } });
      if (existing) {
        return reply.code(409).send({
          error: { code: "slug_exists", message: `Category slug '${slug}' already exists.` },
        });
      }
      const created = await db.productCategory.create({
        data: { ...data, slug },
        select: categorySelect,
      });
      await recordChange("ProductCategory", created.id, "insert", created, req.user!.sub);
      return created;
    }
  );

  app.patch(
    "/categories/:id",
    { preHandler: [app.authenticate] },
    async (req, reply) => {
      if (!requireAdmin(req, reply)) return;
      const id = (req.params as { id: string }).id;
      const data = categoryUpdate.parse(req.body);
      const before = await db.productCategory.findFirst({
        where: { OR: [{ id }, { slug: id }] },
      });
      if (!before) return reply.code(404).send({ error: { code: "not_found" } });

      if (data.slug && data.slug.toLowerCase() !== before.slug) {
        const conflict = await db.productCategory.findUnique({
          where: { slug: data.slug.toLowerCase() },
        });
        if (conflict && conflict.id !== before.id) {
          return reply.code(409).send({
            error: { code: "slug_exists", message: `Slug '${data.slug}' is already in use.` },
          });
        }
      }

      const updated = await db.productCategory.update({
        where: { id: before.id },
        data: {
          ...(data.name !== undefined ? { name: data.name } : {}),
          ...(data.slug !== undefined ? { slug: data.slug.toLowerCase() } : {}),
          ...(data.sortOrder !== undefined ? { sortOrder: data.sortOrder } : {}),
          ...(data.active !== undefined ? { active: data.active } : {}),
        },
        select: categorySelect,
      });
      await recordChange("ProductCategory", before.id, "update", updated, req.user!.sub);
      return updated;
    }
  );

  app.delete(
    "/categories/:id",
    { preHandler: [app.authenticate] },
    async (req, reply) => {
      if (!requireAdmin(req, reply)) return;
      const id = (req.params as { id: string }).id;
      const row = await db.productCategory.findFirst({
        where: { OR: [{ id }, { slug: id }] },
        include: { _count: { select: { products: true } } },
      });
      if (!row) return reply.code(404).send({ error: { code: "not_found" } });
      if (row._count.products > 0) {
        return reply.code(409).send({
          error: {
            code: "category_in_use",
            message: `${row._count.products} product(s) use this category. Reassign them before deleting.`,
          },
        });
      }
      await db.productCategory.delete({ where: { id: row.id } });
      await recordChange("ProductCategory", row.id, "delete", row, req.user!.sub);
      return { deleted: true };
    }
  );

  app.post(
    "/categories/:id/image",
    { preHandler: [app.authenticate] },
    async (req, reply) => {
      if (!requireAdmin(req, reply)) return;
      const id = (req.params as { id: string }).id;
      const row = await db.productCategory.findFirst({
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
      const dest = join(uploadsRoot, "categories", filename);
      await pipeline(data.file, createWriteStream(dest));

      const imageUrl = `/uploads/categories/${filename}`;
      const updated = await db.productCategory.update({
        where: { id: row.id },
        data: { imageUrl },
        select: { id: true, imageUrl: true },
      });
      return updated;
    }
  );
};
