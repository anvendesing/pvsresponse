import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import { z } from "zod";
import { db } from "../db.js";
import { maskShiprocketConfig } from "../lib/shiprocket-config.js";
import { getShiprocketToken } from "../lib/shiprocket.js";
import { recordChange } from "../sync/log.js";

const updateSchema = z.object({
  email: z.string().trim().email().max(120).nullable().optional(),
  password: z.string().trim().max(200).nullable().optional(),
  pickupPincode: z
    .string()
    .trim()
    .regex(/^\d{6}$/, "Pickup pincode must be 6 digits")
    .nullable()
    .optional(),
  active: z.boolean().optional(),
});

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

export const shiprocketProviderRoutes = async (app: FastifyInstance) => {
  app.get("/settings/shiprocket", { preHandler: [app.authenticate] }, async (req, reply) => {
    if (!requireAdmin(req, reply)) return;
    const row = await db.shiprocketConfig.findUnique({ where: { id: "default" } });
    if (!row) {
      return {
        id: "default",
        email: null,
        password: null,
        pickupPincode: null,
        active: false,
        hasPassword: false,
        updatedAt: new Date(),
      };
    }
    return maskShiprocketConfig(row);
  });

  app.patch("/settings/shiprocket", { preHandler: [app.authenticate] }, async (req, reply) => {
    if (!requireAdmin(req, reply)) return;
    const data = updateSchema.parse(req.body);
    const before = await db.shiprocketConfig.findUnique({ where: { id: "default" } });

    const patch: {
      email?: string | null;
      password?: string | null;
      pickupPincode?: string | null;
      active?: boolean;
    } = {};
    if (data.email !== undefined) patch.email = data.email;
    if (data.password !== undefined) patch.password = data.password;
    if (data.pickupPincode !== undefined) patch.pickupPincode = data.pickupPincode;
    if (data.active !== undefined) patch.active = data.active;

    const updated = await db.shiprocketConfig.upsert({
      where: { id: "default" },
      create: {
        id: "default",
        email: data.email ?? null,
        password: data.password ?? null,
        pickupPincode: data.pickupPincode ?? null,
        active: data.active ?? false,
      },
      update: patch,
    });

    await recordChange(
      "ShiprocketConfig" as never,
      updated.id,
      before ? "update" : "insert",
      maskShiprocketConfig(updated),
      req.user!.sub
    );

    return maskShiprocketConfig(updated);
  });

  app.post("/settings/shiprocket/test", { preHandler: [app.authenticate] }, async (req, reply) => {
    if (!requireAdmin(req, reply)) return;
    const token = await getShiprocketToken();
    if (!token) {
      return reply.code(502).send({
        error: {
          code: "auth_failed",
          message:
            "Shiprocket login failed. Check email/password in Settings or SHIPROCKET_EMAIL/PASSWORD env vars.",
        },
      });
    }
    return { ok: true, message: "Shiprocket authentication succeeded." };
  });
};
