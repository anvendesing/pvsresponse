import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { db } from "../db.js";
import { recordChange } from "../sync/log.js";

const punchSchema = z.object({
  empNo: z.string(),
  direction: z.enum(["in", "out", "break"]),
});

export const workforceRoutes = async (app: FastifyInstance) => {
  app.get("/workers", async (req) => {
    const q = (req.query as Record<string, string>) ?? {};
    return db.worker.findMany({
      where: { ...(q.shift ? { shift: q.shift } : {}), active: true },
      orderBy: { empNo: "asc" },
    });
  });

  app.post("/workers/punch", { preHandler: [app.authenticate] }, async (req, reply) => {
    const body = punchSchema.parse(req.body);
    const w = await db.worker.findUnique({ where: { empNo: body.empNo } });
    if (!w) return reply.code(404).send({ error: { code: "not_found", message: "Worker" } });
    const updated = await db.worker.update({
      where: { id: w.id },
      data: { status: body.direction },
    });
    await recordChange("Worker", w.id, "update", updated, req.user.sub);
    // Record attendance event
    if (body.direction === "in" || body.direction === "out") {
      await db.attendance.create({
        data: {
          workerId: w.id,
          date: new Date(),
          shift: w.shift,
          inAt: body.direction === "in" ? new Date() : null,
          outAt: body.direction === "out" ? new Date() : null,
        },
      });
    }
    return updated;
  });

  // -------- Mobile self-service: who am I + punch in/out -----------------
  // The mobile app's Profile screen lives under the worker's User token.
  // /me/worker returns the Worker row linked via Worker.userId so we can
  // show today's punch state, hours, station, etc., without requiring
  // the worker to remember their empNo.
  app.get(
    "/me/worker",
    { preHandler: [app.authenticate] },
    async (req, reply) => {
      const w = await db.worker.findFirst({
        where: { userId: req.user.sub },
        include: {
          attendance: {
            where: {
              date: {
                gte: new Date(new Date().toISOString().slice(0, 10)),
              },
            },
            orderBy: { date: "desc" },
          },
        },
      });
      if (!w) {
        return reply.code(404).send({
          error: {
            code: "not_linked",
            message:
              "No Worker record is linked to your login. Ask a supervisor to link your floor identity.",
          },
        });
      }
      return w;
    }
  );

  app.post(
    "/me/worker/punch",
    { preHandler: [app.authenticate] },
    async (req, reply) => {
      const body = z
        .object({ direction: z.enum(["in", "out", "break"]) })
        .parse(req.body);
      const w = await db.worker.findFirst({
        where: { userId: req.user.sub },
      });
      if (!w) {
        return reply.code(404).send({
          error: {
            code: "not_linked",
            message: "No Worker record linked to this login.",
          },
        });
      }
      const updated = await db.worker.update({
        where: { id: w.id },
        data: { status: body.direction },
      });
      if (body.direction === "in" || body.direction === "out") {
        await db.attendance.create({
          data: {
            workerId: w.id,
            date: new Date(),
            shift: w.shift,
            inAt: body.direction === "in" ? new Date() : null,
            outAt: body.direction === "out" ? new Date() : null,
          },
        });
      }
      await recordChange("Worker", w.id, "update", updated, req.user.sub);
      return updated;
    }
  );

  // PATCH /me/worker/link - one-time helper for an admin to link
  // Worker.userId. We accept (currentUser admin OR self) so supervisors
  // can wire up their team without needing direct DB access.
  app.post(
    "/workers/:id/link-user",
    { preHandler: [app.authenticate] },
    async (req, reply) => {
      const id = (req.params as { id: string }).id;
      const body = z
        .object({ userId: z.string().min(1).nullable() })
        .parse(req.body);
      if (req.user.role !== "admin" && req.user.role !== "supervisor") {
        return reply
          .code(403)
          .send({ error: { code: "forbidden", message: "Admins only" } });
      }
      const w = await db.worker.findUnique({ where: { id } });
      if (!w) return reply.code(404).send({ error: { code: "not_found" } });
      const updated = await db.worker.update({
        where: { id },
        data: { userId: body.userId },
      });
      await recordChange("Worker", id, "update", updated, req.user.sub);
      return updated;
    }
  );
};
