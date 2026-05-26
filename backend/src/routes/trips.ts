// Trips: scheduled vehicle runs with a roster of DispatchOrder drops.
//
// Why trips:
//   - Operators don't want to type vehicle/driver/ETA per invoice. They
//     plan trucks (one per day per region) and assign drops to them.
//   - Trips can be created up to N days in advance, then rescheduled
//     (date pushed) or cancelled. Cancelling rolls all dispatches over
//     to a freshly-generated successor trip on the next day, so no
//     invoice is ever stranded without a transport plan.
//
// Number scheme: TRP-2026-NNNN, sequential within the year.

import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { db } from "../db.js";
import { recordChange } from "../sync/log.js";

const nextTripNo = async (year: number, base: number): Promise<string> => {
  const last = await db.trip.findFirst({
    where: { tripNo: { startsWith: `TRP-${year}-` } },
    orderBy: { tripNo: "desc" },
    select: { tripNo: true },
  });
  if (!last) return `TRP-${year}-${base}`;
  const n = parseInt(last.tripNo.split("-").pop() ?? `${base - 1}`, 10);
  return `TRP-${year}-${n + 1}`;
};

const fullTripInclude = {
  dispatches: {
    orderBy: { createdAt: "asc" },
    include: {
      invoice: {
        select: {
          id: true,
          invoiceNo: true,
          amount: true,
          status: true,
          customer: {
            select: { id: true, name: true, code: true, city: true, contact: true },
          },
        },
      },
    },
  },
} as const;

// Normalise an incoming date to UTC midnight so `scheduledDate` is
// purely a calendar concept (no time component).
const normaliseDate = (raw: string | Date): Date => {
  const d = typeof raw === "string" ? new Date(raw) : raw;
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
};

const tripCreate = z.object({
  scheduledDate: z.string().min(8),
  vehicle: z.string().min(1),
  driver: z.string().min(1),
  route: z.string().nullable().optional(),
  capacityKg: z.number().nonnegative().default(1000),
  notes: z.string().nullable().optional(),
});

const tripUpdate = z.object({
  scheduledDate: z.string().min(8).optional(),
  vehicle: z.string().min(1).optional(),
  driver: z.string().min(1).optional(),
  route: z.string().nullable().optional(),
  capacityKg: z.number().nonnegative().optional(),
  notes: z.string().nullable().optional(),
});

export const tripRoutes = async (app: FastifyInstance) => {
  // ----------------------------------------------------- LIST
  // Optional ?from=YYYY-MM-DD&to=YYYY-MM-DD (inclusive). Defaults to a
  // window from today through 7 days ahead, plus any in-flight trips
  // (in_transit / scheduled regardless of date) so operators always see
  // the queue.
  app.get("/trips", { preHandler: [app.authenticate] }, async (req) => {
    const q = (req.query as Record<string, string>) ?? {};
    const where: Record<string, unknown> = {};
    if (q.status) where.status = q.status;
    if (q.from || q.to) {
      const range: Record<string, Date> = {};
      if (q.from) range.gte = normaliseDate(q.from);
      if (q.to) {
        const t = normaliseDate(q.to);
        // make 'to' inclusive of the whole day
        range.lt = new Date(t.getTime() + 86400000);
      }
      where.scheduledDate = range;
    }
    return db.trip.findMany({
      where,
      include: fullTripInclude,
      orderBy: [{ scheduledDate: "asc" }, { createdAt: "asc" }],
    });
  });

  // ----------------------------------------------------- DETAIL
  app.get("/trips/:id", { preHandler: [app.authenticate] }, async (req, reply) => {
    const id = (req.params as { id: string }).id;
    const t = await db.trip.findUnique({ where: { id }, include: fullTripInclude });
    if (!t) return reply.code(404).send({ error: { code: "not_found" } });
    return t;
  });

  // ----------------------------------------------------- CREATE
  app.post("/trips", { preHandler: [app.authenticate] }, async (req) => {
    const body = tripCreate.parse(req.body);
    const tripNo = await nextTripNo(2026, 3001);
    const created = await db.trip.create({
      data: {
        tripNo,
        scheduledDate: normaliseDate(body.scheduledDate),
        vehicle: body.vehicle,
        driver: body.driver,
        route: body.route ?? null,
        capacityKg: body.capacityKg,
        notes: body.notes ?? null,
        createdById: req.user.sub,
      },
      include: fullTripInclude,
    });
    await recordChange("Trip", created.id, "insert", created, req.user.sub);
    return created;
  });

  // ----------------------------------------------------- UPDATE / RESCHEDULE
  // Reschedule = PATCH with a new scheduledDate. Allowed only when the
  // trip hasn't started yet (status === "scheduled"). For in-progress
  // or completed trips we 409.
  app.patch(
    "/trips/:id",
    { preHandler: [app.authenticate] },
    async (req, reply) => {
      const id = (req.params as { id: string }).id;
      const body = tripUpdate.parse(req.body);
      const t = await db.trip.findUnique({ where: { id } });
      if (!t) return reply.code(404).send({ error: { code: "not_found" } });
      if (t.status !== "scheduled") {
        return reply.code(409).send({
          error: {
            code: "locked",
            message: `Trip is '${t.status}', cannot edit.`,
          },
        });
      }
      const data: Record<string, unknown> = {};
      if (body.scheduledDate)
        data.scheduledDate = normaliseDate(body.scheduledDate);
      if (body.vehicle !== undefined) data.vehicle = body.vehicle;
      if (body.driver !== undefined) data.driver = body.driver;
      if (body.route !== undefined) data.route = body.route;
      if (body.capacityKg !== undefined) data.capacityKg = body.capacityKg;
      if (body.notes !== undefined) data.notes = body.notes;
      const updated = await db.trip.update({
        where: { id },
        data,
        include: fullTripInclude,
      });
      await recordChange("Trip", id, "update", updated, req.user.sub);
      return updated;
    }
  );

  // ----------------------------------------------------- START
  app.post(
    "/trips/:id/start",
    { preHandler: [app.authenticate] },
    async (req, reply) => {
      const id = (req.params as { id: string }).id;
      const t = await db.trip.findUnique({
        where: { id },
        include: { dispatches: true },
      });
      if (!t) return reply.code(404).send({ error: { code: "not_found" } });
      if (t.status !== "scheduled") {
        return reply.code(409).send({
          error: { code: "bad_state", message: `Trip is '${t.status}'.` },
        });
      }
      const updated = await db.trip.update({
        where: { id },
        data: { status: "in_transit", startedAt: new Date() },
        include: fullTripInclude,
      });
      // Dispatches inherit "in-transit"
      await db.dispatchOrder.updateMany({
        where: { tripId: id },
        data: { status: "in-transit" },
      });
      await recordChange("Trip", id, "update", updated, req.user.sub);
      return updated;
    }
  );

  // ----------------------------------------------------- COMPLETE
  app.post(
    "/trips/:id/complete",
    { preHandler: [app.authenticate] },
    async (req, reply) => {
      const id = (req.params as { id: string }).id;
      const t = await db.trip.findUnique({
        where: { id },
        include: { dispatches: true },
      });
      if (!t) return reply.code(404).send({ error: { code: "not_found" } });
      if (t.status !== "in_transit") {
        return reply.code(409).send({
          error: { code: "bad_state", message: `Trip is '${t.status}'.` },
        });
      }
      // Mark every dispatch on this trip as delivered.
      await db.dispatchOrder.updateMany({
        where: { tripId: id, status: { not: "delivered" } },
        data: { status: "delivered", otpVerified: true, signedAt: new Date() },
      });
      const updated = await db.trip.update({
        where: { id },
        data: { status: "completed", completedAt: new Date() },
        include: fullTripInclude,
      });
      await recordChange("Trip", id, "update", updated, req.user.sub);
      return updated;
    }
  );

  // ----------------------------------------------------- CANCEL with rollover
  // Every cancel is a "soft" cancel: the trip is marked cancelled and a
  // successor trip is created on the next day with the same vehicle /
  // driver / route / capacity. All dispatches that were assigned move
  // over to the new trip so invoices are never stranded.
  app.post(
    "/trips/:id/cancel",
    { preHandler: [app.authenticate] },
    async (req, reply) => {
      const id = (req.params as { id: string }).id;
      const body = z
        .object({ reason: z.string().nullable().optional() })
        .parse(req.body ?? {});
      const t = await db.trip.findUnique({
        where: { id },
        include: { dispatches: true },
      });
      if (!t) return reply.code(404).send({ error: { code: "not_found" } });
      if (t.status === "cancelled" || t.status === "completed") {
        return reply.code(409).send({
          error: { code: "bad_state", message: `Trip is '${t.status}'.` },
        });
      }

      // Skip rollover if there are no dispatches on the trip - nothing
      // to migrate, no successor needed.
      let successor: Awaited<ReturnType<typeof db.trip.create>> | null = null;
      if (t.dispatches.length > 0) {
        const nextDate = new Date(t.scheduledDate.getTime() + 86400000);
        const tripNo = await nextTripNo(2026, 3001);
        successor = await db.trip.create({
          data: {
            tripNo,
            scheduledDate: nextDate,
            vehicle: t.vehicle,
            driver: t.driver,
            route: t.route,
            capacityKg: t.capacityKg,
            notes: `Auto-rescheduled from ${t.tripNo}`,
            rolledOverFromId: t.id,
            createdById: req.user.sub,
          },
        });
        await db.dispatchOrder.updateMany({
          where: { tripId: id },
          data: { tripId: successor.id },
        });
      }

      const updated = await db.trip.update({
        where: { id },
        data: {
          status: "cancelled",
          cancelledAt: new Date(),
          notes: body.reason
            ? (t.notes ? `${t.notes}\nCancelled: ${body.reason}` : `Cancelled: ${body.reason}`)
            : t.notes,
        },
        include: fullTripInclude,
      });
      await recordChange("Trip", id, "update", updated, req.user.sub);
      if (successor) await recordChange("Trip", successor.id, "insert", successor, req.user.sub);

      // Re-fetch successor with full include so the UI can render the
      // banner without a second round trip.
      const successorFull = successor
        ? await db.trip.findUnique({
            where: { id: successor.id },
            include: fullTripInclude,
          })
        : null;
      return { trip: updated, successor: successorFull };
    }
  );

  // ----------------------------------------------------- ASSIGN existing dispatch
  app.post(
    "/trips/:id/dispatches",
    { preHandler: [app.authenticate] },
    async (req, reply) => {
      const id = (req.params as { id: string }).id;
      const body = z
        .object({ dispatchId: z.string().min(1) })
        .parse(req.body);
      const t = await db.trip.findUnique({ where: { id } });
      if (!t) return reply.code(404).send({ error: { code: "not_found" } });
      if (t.status !== "scheduled") {
        return reply.code(409).send({
          error: {
            code: "locked",
            message: `Trip is '${t.status}', cannot assign drops.`,
          },
        });
      }
      const d = await db.dispatchOrder.findUnique({
        where: { id: body.dispatchId },
      });
      if (!d) {
        return reply
          .code(404)
          .send({ error: { code: "dispatch_not_found" } });
      }
      const updatedDispatch = await db.dispatchOrder.update({
        where: { id: d.id },
        data: { tripId: t.id },
      });
      await recordChange(
        "DispatchOrder",
        d.id,
        "update",
        updatedDispatch,
        req.user.sub
      );
      return db.trip.findUnique({ where: { id }, include: fullTripInclude });
    }
  );

  // ----------------------------------------------------- UNASSIGN
  app.delete(
    "/trips/:id/dispatches/:dispatchId",
    { preHandler: [app.authenticate] },
    async (req, reply) => {
      const { id, dispatchId } = req.params as {
        id: string;
        dispatchId: string;
      };
      const t = await db.trip.findUnique({ where: { id } });
      if (!t) return reply.code(404).send({ error: { code: "not_found" } });
      if (t.status !== "scheduled") {
        return reply.code(409).send({
          error: { code: "locked", message: `Trip is '${t.status}'.` },
        });
      }
      const d = await db.dispatchOrder.findUnique({ where: { id: dispatchId } });
      if (!d || d.tripId !== id) {
        return reply
          .code(404)
          .send({ error: { code: "dispatch_not_on_trip" } });
      }
      await db.dispatchOrder.update({
        where: { id: dispatchId },
        data: { tripId: null },
      });
      await recordChange("DispatchOrder", dispatchId, "update", { tripId: null }, req.user.sub);
      return db.trip.findUnique({ where: { id }, include: fullTripInclude });
    }
  );

  // ----------------------------------------------------- AUTO-SCHEDULE
  // Convenience endpoint: ensure there's at least one trip per day for
  // the next N days (default 4). Skips days that already have a
  // scheduled trip, so calling repeatedly is idempotent.
  app.post(
    "/trips/auto-schedule",
    { preHandler: [app.authenticate] },
    async (req) => {
      const body = z
        .object({
          days: z.number().int().min(1).max(14).default(4),
          vehicle: z.string().default("TBD"),
          driver: z.string().default("TBD"),
          route: z.string().nullable().optional(),
          capacityKg: z.number().nonnegative().default(1000),
        })
        .parse(req.body ?? {});

      const today = normaliseDate(new Date());
      const created: Array<{ tripNo: string; scheduledDate: Date }> = [];
      for (let i = 0; i < body.days; i++) {
        const date = new Date(today.getTime() + i * 86400000);
        const existing = await db.trip.count({
          where: { scheduledDate: date, status: "scheduled" },
        });
        if (existing > 0) continue;
        const tripNo = await nextTripNo(2026, 3001);
        const t = await db.trip.create({
          data: {
            tripNo,
            scheduledDate: date,
            vehicle: body.vehicle,
            driver: body.driver,
            route: body.route ?? null,
            capacityKg: body.capacityKg,
            createdById: req.user.sub,
          },
        });
        await recordChange("Trip", t.id, "insert", t, req.user.sub);
        created.push({ tripNo: t.tripNo, scheduledDate: t.scheduledDate });
      }
      return { created };
    }
  );

  // ----------------------------------------------------- UNASSIGNED dispatches
  // Used by the trip-detail "+ Add invoice drop" picker: returns
  // dispatch orders that haven't been assigned to any trip yet.
  app.get(
    "/dispatches/unassigned",
    { preHandler: [app.authenticate] },
    async () =>
      db.dispatchOrder.findMany({
        where: {
          tripId: null,
          status: { in: ["planned", "loading"] },
        },
        include: {
          invoice: {
            select: {
              id: true,
              invoiceNo: true,
              amount: true,
              customer: { select: { name: true, city: true } },
            },
          },
        },
        orderBy: { createdAt: "desc" },
      })
  );
};
