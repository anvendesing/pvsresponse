import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import { z } from "zod";
import { db } from "../db.js";
import { maskGatewayConfig } from "../lib/razorpay.js";
import { recordChange } from "../sync/log.js";

const gatewayIdSchema = z.enum(["razorpay", "ccavenue", "payu"]);

const gatewayUpdateSchema = z.object({
  mode: z.enum(["test", "live"]).optional(),
  keyId: z.string().trim().max(120).nullable().optional(),
  keySecret: z.string().trim().max(200).nullable().optional(),
  webhookSecret: z.string().trim().max(200).nullable().optional(),
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

export const paymentGatewayRoutes = async (app: FastifyInstance) => {
  app.get(
    "/settings/payment-gateways",
    { preHandler: [app.authenticate] },
    async (req, reply) => {
      if (!requireAdmin(req, reply)) return;
      const rows = await db.paymentGatewayConfig.findMany({
        orderBy: { gateway: "asc" },
      });
      return rows.map(maskGatewayConfig);
    }
  );

  app.get(
    "/settings/payment-gateways/:gateway",
    { preHandler: [app.authenticate] },
    async (req, reply) => {
      if (!requireAdmin(req, reply)) return;
      const gateway = gatewayIdSchema.parse((req.params as { gateway: string }).gateway);
      const row = await db.paymentGatewayConfig.findUnique({ where: { gateway } });
      if (!row) {
        return reply.code(404).send({ error: { code: "not_found" } });
      }
      return maskGatewayConfig(row);
    }
  );

  app.patch(
    "/settings/payment-gateways/:gateway",
    { preHandler: [app.authenticate] },
    async (req, reply) => {
      if (!requireAdmin(req, reply)) return;
      const gateway = gatewayIdSchema.parse((req.params as { gateway: string }).gateway);
      const data = gatewayUpdateSchema.parse(req.body);
      const before = await db.paymentGatewayConfig.findUnique({ where: { gateway } });

      const patch: {
        mode?: string;
        keyId?: string | null;
        keySecret?: string | null;
        webhookSecret?: string | null;
        active?: boolean;
      } = {};
      if (data.mode !== undefined) patch.mode = data.mode;
      if (data.keyId !== undefined) patch.keyId = data.keyId;
      if (data.keySecret !== undefined) patch.keySecret = data.keySecret;
      if (data.webhookSecret !== undefined) patch.webhookSecret = data.webhookSecret;
      if (data.active !== undefined) patch.active = data.active;

      const updated = await db.paymentGatewayConfig.upsert({
        where: { gateway },
        create: {
          gateway,
          mode: data.mode ?? "test",
          keyId: data.keyId ?? null,
          keySecret: data.keySecret ?? null,
          webhookSecret: data.webhookSecret ?? null,
          active: data.active ?? false,
        },
        update: patch,
      });

      await recordChange(
        "PaymentGatewayConfig" as never,
        updated.id,
        before ? "update" : "insert",
        maskGatewayConfig(updated),
        req.user!.sub
      );

      return maskGatewayConfig(updated);
    }
  );
};
