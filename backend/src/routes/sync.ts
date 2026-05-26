import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { db } from "../db.js";
import { pull, push, SYNCABLE_ENTITIES } from "../sync/engine.js";

const pullSchema = z.object({
  deviceId: z.string().min(1),
  since: z.string().optional(),
  cursor: z.coerce.number().int().nonnegative().default(0),
  limit: z.coerce.number().int().positive().max(2000).default(500),
});

const pushSchema = z.object({
  deviceId: z.string().min(1),
  mutations: z.array(
    z.object({
      entity: z.enum(SYNCABLE_ENTITIES),
      entityId: z.string(),
      op: z.enum(["insert", "update", "delete"]),
      baseVersion: z.number().int().optional(),
      payload: z.record(z.string(), z.unknown()),
      clientTime: z.string(),
    })
  ),
});

export const syncRoutes = async (app: FastifyInstance) => {
  app.get("/sync/info", async () => ({
    entities: SYNCABLE_ENTITIES,
    serverTime: new Date().toISOString(),
    appendOnly: ["StockLedger", "AuditLog", "Attendance"],
  }));

  app.get("/sync/pull", { preHandler: [app.authenticate] }, async (req) => {
    const q = pullSchema.parse(req.query);
    return pull(q.deviceId, q.since ? new Date(q.since) : undefined, q.cursor, q.limit);
  });

  app.post("/sync/push", { preHandler: [app.authenticate] }, async (req) => {
    const body = pushSchema.parse(req.body);
    return push(body.deviceId, body.mutations);
  });

  app.get("/sync/state/:deviceId", { preHandler: [app.authenticate] }, async (req) => {
    const id = (req.params as { deviceId: string }).deviceId;
    const state = await db.syncState.findUnique({ where: { deviceId: id } });
    return state ?? null;
  });

  app.get("/sync/conflicts/:deviceId", { preHandler: [app.authenticate] }, async (req) => {
    const id = (req.params as { deviceId: string }).deviceId;
    return db.syncConflict.findMany({ where: { deviceId: id }, take: 200, orderBy: { createdAt: "desc" } });
  });
};
