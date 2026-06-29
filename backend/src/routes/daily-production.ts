import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import { z } from "zod";
import {
  listDailyProductionLogs,
  postDailyProduction,
  previewDailyProduction,
  resolveMaterialScan,
  resolveOutputLine,
} from "../lib/daily-production.js";

const requireWriter = (req: FastifyRequest, reply: FastifyReply): boolean => {
  const role = req.user.role;
  if (role === "admin" || role === "supervisor") return true;
  reply.code(403).send({ error: { code: "forbidden" } });
  return false;
};

const outputLine = z.object({
  barcode: z.string().trim().min(1),
  qty: z.number().positive(),
});

const materialScan = z.object({
  barcode: z.string().trim().min(1),
});

export const dailyProductionRoutes = async (app: FastifyInstance) => {
  app.get("/daily-production/logs", { preHandler: [app.authenticate] }, async (req) => {
    const q = (req.query as { limit?: string }) ?? {};
    const limit = q.limit ? Math.min(parseInt(q.limit, 10) || 50, 200) : 50;
    return listDailyProductionLogs(limit);
  });

  app.post(
    "/daily-production/resolve-output",
    { preHandler: [app.authenticate] },
    async (req, reply) => {
      const body = outputLine.parse(req.body);
      try {
        const row = await resolveOutputLine(body);
        return row;
      } catch (e) {
        const err = e as Error & { statusCode?: number };
        return reply.code(err.statusCode ?? 400).send({
          error: { code: "resolve_failed", message: err.message },
        });
      }
    }
  );

  app.post(
    "/daily-production/resolve-material",
    { preHandler: [app.authenticate] },
    async (req, reply) => {
      const body = materialScan.parse(req.body);
      try {
        return await resolveMaterialScan(body.barcode);
      } catch (e) {
        const err = e as Error & { statusCode?: number };
        return reply.code(err.statusCode ?? 400).send({
          error: { code: "resolve_failed", message: err.message },
        });
      }
    }
  );

  app.post(
    "/daily-production/preview",
    { preHandler: [app.authenticate] },
    async (req, reply) => {
      const body = z
        .object({
          outputs: z.array(outputLine).min(1),
          materialScans: z.array(materialScan).optional(),
        })
        .parse(req.body);
      try {
        return await previewDailyProduction(body);
      } catch (e) {
        const err = e as Error & { statusCode?: number };
        return reply.code(err.statusCode ?? 400).send({
          error: { code: "preview_failed", message: err.message },
        });
      }
    }
  );

  app.post(
    "/daily-production/log",
    { preHandler: [app.authenticate] },
    async (req, reply) => {
      if (!requireWriter(req, reply)) return;
      const body = z
        .object({
          outputs: z.array(outputLine).min(1),
          materialScans: z.array(materialScan).optional(),
          notes: z.string().max(500).nullable().optional(),
          allowShortMaterials: z.boolean().optional(),
          clientOpId: z.string().min(8).max(64).optional(),
        })
        .parse(req.body);
      try {
        return await postDailyProduction({
          ...body,
          userId: req.user.sub,
        });
      } catch (e) {
        const err = e as Error & { statusCode?: number; code?: string };
        return reply.code(err.statusCode ?? 400).send({
          error: { code: err.code ?? "post_failed", message: err.message },
        });
      }
    }
  );
};
