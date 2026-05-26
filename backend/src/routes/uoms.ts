// UoM master endpoints.
//
// Provides:
//   GET  /uoms                  - flat list with category info
//   GET  /uom-categories        - categories with their UoMs nested
//   POST /uoms/normalize        - normalize a free-text uom string
//                                  to a canonical code (used by import
//                                  flows so the UI can validate input)
//   POST /uoms/convert          - convert qty between codes in same
//                                  category
//
// All endpoints are authenticated read-only; there's no UoM CRUD UI -
// the master is fixed at deployment via scripts/seed-uoms.ts. If you
// later need user-defined UoMs add explicit POST/PATCH/DELETE here.
import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { db } from "../db.js";
import { convertUom, normalizeUomCode } from "../lib/uom.js";

export const uomRoutes = async (app: FastifyInstance) => {
  app.get("/uoms", { preHandler: [app.authenticate] }, async (req) => {
    const q = (req.query as Record<string, string>) ?? {};
    const where: Record<string, unknown> = {};
    if (q.active === "true") where.active = true;
    if (q.category) where.category = { code: q.category };
    return db.uom.findMany({
      where,
      include: {
        category: { select: { code: true, name: true } },
      },
      orderBy: [{ category: { code: "asc" } }, { factor: "asc" }],
    });
  });

  app.get(
    "/uom-categories",
    { preHandler: [app.authenticate] },
    async () => {
      return db.uomCategory.findMany({
        include: {
          uoms: {
            where: { active: true },
            orderBy: { factor: "asc" },
          },
        },
        orderBy: { code: "asc" },
      });
    }
  );

  app.post(
    "/uoms/normalize",
    { preHandler: [app.authenticate] },
    async (req, reply) => {
      const body = z
        .object({ input: z.string() })
        .parse(req.body);
      const code = normalizeUomCode(body.input);
      if (!code) {
        return reply.code(404).send({
          error: {
            code: "uom_unknown",
            message: `No canonical mapping for "${body.input}"`,
          },
        });
      }
      const uom = await db.uom.findUnique({
        where: { code },
        include: { category: { select: { code: true, name: true } } },
      });
      return { input: body.input, code, uom };
    }
  );

  app.post(
    "/uoms/convert",
    { preHandler: [app.authenticate] },
    async (req, reply) => {
      const body = z
        .object({
          qty: z.number(),
          from: z.string().min(1),
          to: z.string().min(1),
        })
        .parse(req.body);
      const all = await db.uom.findMany({
        include: { category: { select: { code: true } } },
      });
      const flat = all.map((u) => ({
        code: u.code,
        categoryCode: u.category.code,
        factor: u.factor,
      }));
      try {
        const result = convertUom(body.qty, body.from, body.to, flat);
        return { qty: body.qty, from: body.from, to: body.to, result };
      } catch (e) {
        return reply.code(400).send({
          error: { code: "uom_convert_failed", message: (e as Error).message },
        });
      }
    }
  );
};
