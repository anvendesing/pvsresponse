import type { FastifyInstance, FastifyRequest } from "fastify";
import { Readable } from "stream";
import { db } from "../db.js";
import {
  getRazorpayCredentials,
  verifyWebhookSignature,
} from "../lib/razorpay.js";
import { confirmPaymentIntentById } from "../services/storefront-order.js";
import { logSystemError, logSystemInfo, logSystemWarn } from "../lib/system-log.js";

type ReqWithRaw = FastifyRequest & { rawBody?: string };

export const razorpayWebhookRoutes = async (app: FastifyInstance) => {
  app.addHook("preParsing", async (request, _reply, payload) => {
    if (!request.url.includes("/webhooks/razorpay")) return payload;
    const chunks: Buffer[] = [];
    for await (const chunk of payload) {
      chunks.push(typeof chunk === "string" ? Buffer.from(chunk) : chunk);
    }
    const raw = Buffer.concat(chunks);
    (request as ReqWithRaw).rawBody = raw.toString("utf8");
    return Readable.from([raw]);
  });

  app.post("/webhooks/razorpay", async (req, reply) => {
    const rawBody = (req as ReqWithRaw).rawBody;
    if (!rawBody) {
      return reply.code(400).send({ error: { code: "missing_body", message: "Empty body." } });
    }

    const signature = req.headers["x-razorpay-signature"];
    if (typeof signature !== "string" || !signature) {
      return reply.code(400).send({
        error: { code: "missing_signature", message: "x-razorpay-signature required." },
      });
    }

    const creds = await getRazorpayCredentials();
    if (!creds?.webhookSecret) {
      return reply.code(503).send({
        error: { code: "webhook_not_configured", message: "Webhook secret not configured." },
      });
    }

    if (!verifyWebhookSignature(rawBody, signature, creds.webhookSecret)) {
      return reply.code(400).send({
        error: { code: "invalid_signature", message: "Webhook signature verification failed." },
      });
    }

    let event: {
      event?: string;
      payload?: {
        payment?: { entity?: { id?: string; order_id?: string; status?: string } };
      };
    };
    try {
      event = JSON.parse(rawBody) as typeof event;
    } catch {
      return reply.code(400).send({ error: { code: "invalid_json", message: "Bad JSON." } });
    }

    if (event.event === "payment.captured") {
      const payment = event.payload?.payment?.entity;
      const orderId = payment?.order_id;
      const paymentId = payment?.id;
      if (orderId && paymentId) {
        // Atomic claim: only one concurrent webhook can flip status from
        // 'created' → 'processing'. updateMany returns count=0 for the loser,
        // which safely skips fulfillment without creating a duplicate SO.
        const claimed = await db.paymentIntent.updateMany({
          where: { gatewayOrderId: orderId, status: "created" },
          data: { status: "processing" },
        });
        if (claimed.count === 0) {
          // Already claimed by another webhook call or the client-side confirm.
          await logSystemInfo("razorpay", "webhook_captured", "Intent already claimed — skipping", {
            orderId,
            paymentId,
          });
        } else {
          const intent = await db.paymentIntent.findUnique({
            where: { gatewayOrderId: orderId },
          });
          if (intent && !intent.salesOrderId) {
            try {
              await confirmPaymentIntentById(
                intent.id,
                paymentId,
                orderId,
                "",
                creds.keySecret,
                { trustedWebhook: true }
              );
              await logSystemInfo("razorpay", "webhook_captured", "Order fulfilled via webhook", {
                intentId: intent.id,
                orderId,
                paymentId,
              });
            } catch (err) {
              // Revert claim so the operator can retry or the client-side confirm
              // still has a chance.
              await db.paymentIntent
                .updateMany({
                  where: { gatewayOrderId: orderId, status: "processing" },
                  data: { status: "created" },
                })
                .catch(() => undefined);
              await logSystemError(
                "razorpay",
                "webhook_captured",
                err instanceof Error ? err.message : String(err),
                { intentId: intent.id, orderId, paymentId }
              );
            }
          }
        }
      }
    }

    if (event.event === "payment.failed") {
      const payment = event.payload?.payment?.entity;
      const orderId = payment?.order_id;
      if (orderId) {
        const result = await db.paymentIntent.updateMany({
          where: { gatewayOrderId: orderId, status: { in: ["created", "processing"] } },
          data: { status: "failed", gatewayPaymentId: payment?.id ?? null },
        });
        if (result.count > 0) {
          await logSystemWarn("razorpay", "payment_failed", "Payment failed", {
            orderId,
            paymentId: payment?.id,
          });
        }
      }
    }

    return { ok: true };
  });
};
