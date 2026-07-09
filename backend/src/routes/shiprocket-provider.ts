import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import { z } from "zod";
import { db } from "../db.js";
import { maskShiprocketConfig } from "../lib/shiprocket-config.js";
import { getShiprocketToken } from "../lib/shiprocket.js";
import { recordChange } from "../sync/log.js";

type ShiprocketPickupLocation = {
  id: number;
  pickup_location: string;
  address: string;
  city: string;
  state: string;
  pin_code: string;
  phone: string;
  email: string | null;
  status: number;
};

const updateSchema = z.object({
  email: z.string().trim().email().max(120).nullable().optional(),
  password: z.string().trim().max(200).nullable().optional(),
  pickupPincode: z
    .string()
    .trim()
    .regex(/^\d{6}$/, "Pickup pincode must be 6 digits")
    .nullable()
    .optional(),
  pickupLocation: z.string().trim().max(200).nullable().optional(),
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
      pickupLocation?: string | null;
      active?: boolean;
    } = {};
    if (data.email !== undefined) patch.email = data.email;
    if (data.password !== undefined) patch.password = data.password;
    if (data.pickupPincode !== undefined) patch.pickupPincode = data.pickupPincode;
    if (data.pickupLocation !== undefined) patch.pickupLocation = data.pickupLocation;
    if (data.active !== undefined) patch.active = data.active;

    const updated = await db.shiprocketConfig.upsert({
      where: { id: "default" },
      create: {
        id: "default",
        email: data.email ?? null,
        password: data.password ?? null,
        pickupPincode: data.pickupPincode ?? null,
        pickupLocation: data.pickupLocation ?? null,
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

  // Fetch pickup locations registered in the Shiprocket panel.
  // The operator selects one and saves it so the dispatch call uses
  // the exact name Shiprocket expects in the `pickup_location` field.
  app.get("/settings/shiprocket/pickup-locations", { preHandler: [app.authenticate] }, async (req, reply) => {
    if (!requireAdmin(req, reply)) return;
    const token = await getShiprocketToken();
    if (!token) {
      return reply.code(502).send({
        error: { code: "auth_failed", message: "Shiprocket login failed." },
      });
    }
    const res = await fetch("https://apiv2.shiprocket.in/v1/external/settings/company/pickup", {
      headers: { Authorization: `Bearer ${token}` },
    });
    if (!res.ok) {
      const body = (await res.json().catch(() => ({}))) as { message?: string };
      return reply.code(502).send({
        error: { code: "shiprocket_error", message: body.message ?? `HTTP ${res.status}` },
      });
    }
    const json = (await res.json()) as {
      data?: { shipping_address?: ShiprocketPickupLocation[] };
    };
    const locations: ShiprocketPickupLocation[] = json.data?.shipping_address ?? [];
    // Shiprocket sometimes returns status as a string ("1") rather than a number.
    // Coerce to Number so the === 1 check in the frontend works reliably.
    return locations.map((l) => ({
      name: l.pickup_location,
      address: [l.address, l.city, l.state, l.pin_code].filter(Boolean).join(", "),
      phone: l.phone,
      status: Number(l.status),
    }));
  });
};
