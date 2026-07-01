import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import { z } from "zod";
import { db } from "../db.js";
import { maskSmsConfig, sendOtpSms, sendSms } from "../lib/smsidea.js";
import { DLT_TEMPLATES } from "../lib/dlt-templates.js";
import { recordChange } from "../sync/log.js";

const updateSchema = z.object({
  provider: z.enum(["smsidea"]).optional(),
  mode: z.enum(["test", "live"]).optional(),
  username: z.string().trim().max(120).nullable().optional(),
  password: z.string().trim().max(200).nullable().optional(),
  senderId: z.string().trim().max(40).nullable().optional(),
  templateId: z.string().trim().max(80).nullable().optional(),
  templateText: z.string().trim().max(500).nullable().optional(),
  orderTemplateId: z.string().trim().max(80).nullable().optional(),
  orderTemplateText: z.string().trim().max(500).nullable().optional(),
  peid: z.string().trim().max(80).nullable().optional(),
  active: z.boolean().optional(),
});

const testSchema = z.object({
  phone: z.string().trim().min(6).max(20),
  message: z.string().trim().min(1).max(500).optional(),
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

export const smsProviderRoutes = async (app: FastifyInstance) => {
  app.get("/settings/sms-provider", { preHandler: [app.authenticate] }, async (req, reply) => {
    if (!requireAdmin(req, reply)) return;
    const row = await db.smsProviderConfig.findUnique({ where: { id: "default" } });
    if (!row) {
      return {
        id: "default",
        provider: "smsidea",
        mode: "test",
        username: null,
        password: null,
        senderId: DLT_TEMPLATES.otp.senderId,
        templateId: DLT_TEMPLATES.otp.templateId,
        templateText: DLT_TEMPLATES.otp.content,
        orderTemplateId: DLT_TEMPLATES.orderConfirm.templateId,
        orderTemplateText: DLT_TEMPLATES.orderConfirm.content,
        peid: null,
        active: false,
        hasPassword: false,
      };
    }
    return maskSmsConfig(row);
  });

  app.patch("/settings/sms-provider", { preHandler: [app.authenticate] }, async (req, reply) => {
    if (!requireAdmin(req, reply)) return;
    const data = updateSchema.parse(req.body);
    const before = await db.smsProviderConfig.findUnique({ where: { id: "default" } });

    const patch: {
      provider?: string;
      mode?: string;
      username?: string | null;
      password?: string | null;
      senderId?: string | null;
      templateId?: string | null;
      templateText?: string | null;
      orderTemplateId?: string | null;
      orderTemplateText?: string | null;
      peid?: string | null;
      active?: boolean;
    } = {};
    if (data.provider !== undefined) patch.provider = data.provider;
    if (data.mode !== undefined) patch.mode = data.mode;
    if (data.username !== undefined) patch.username = data.username;
    if (data.password !== undefined) patch.password = data.password;
    if (data.senderId !== undefined) patch.senderId = data.senderId;
    if (data.templateId !== undefined) patch.templateId = data.templateId;
    if (data.templateText !== undefined) patch.templateText = data.templateText;
    if (data.orderTemplateId !== undefined) patch.orderTemplateId = data.orderTemplateId;
    if (data.orderTemplateText !== undefined) patch.orderTemplateText = data.orderTemplateText;
    if (data.peid !== undefined) patch.peid = data.peid;
    if (data.active !== undefined) patch.active = data.active;

    const updated = await db.smsProviderConfig.upsert({
      where: { id: "default" },
      create: {
        id: "default",
        provider: data.provider ?? "smsidea",
        mode: data.mode ?? "test",
        username: data.username ?? null,
        password: data.password ?? null,
        senderId: data.senderId ?? null,
        templateId: data.templateId ?? DLT_TEMPLATES.otp.templateId,
        templateText: data.templateText ?? DLT_TEMPLATES.otp.content,
        orderTemplateId: data.orderTemplateId ?? DLT_TEMPLATES.orderConfirm.templateId,
        orderTemplateText: data.orderTemplateText ?? DLT_TEMPLATES.orderConfirm.content,
        peid: data.peid ?? null,
        active: data.active ?? false,
      },
      update: patch,
    });

    await recordChange(
      "SmsProviderConfig" as never,
      updated.id,
      before ? "update" : "insert",
      maskSmsConfig(updated),
      req.user!.sub
    );

    return maskSmsConfig(updated);
  });

  app.post("/settings/sms-provider/test", { preHandler: [app.authenticate] }, async (req, reply) => {
    if (!requireAdmin(req, reply)) return;
    const body = testSchema.parse(req.body);
    const credsRow = await db.smsProviderConfig.findUnique({ where: { id: "default" } });
    if (body.message) {
      const result = await sendSms(body.phone, body.message, credsRow?.templateId ?? undefined);
      if (!result.ok) {
        return reply.code(502).send({
          error: { code: "send_failed", message: result.error ?? "SMS send failed." },
        });
      }
      return { ok: true, ref: result.ref };
    }

    const result = await sendOtpSms(body.phone, "123456", "settings_test");
    if (!result.ok) {
      return reply.code(502).send({
        error: { code: "send_failed", message: result.error ?? "SMS send failed." },
      });
    }
    return { ok: true, ref: result.ref };
  });
};
