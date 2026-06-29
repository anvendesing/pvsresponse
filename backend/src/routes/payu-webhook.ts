import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import { config } from "../config.js";
import { db } from "../db.js";
import {
  getPayuCredentials,
  parsePayuResponseBody,
  verifyPayuResponseHash,
} from "../lib/payu.js";
import { confirmPayuPaymentIntentById } from "../services/storefront-order.js";
import { logSystemError, logSystemInfo } from "../lib/system-log.js";

type ReqWithFields = FastifyRequest & { payuFields?: Record<string, unknown> };

const collectPayuFields = (req: FastifyRequest): Record<string, unknown> => {
  const body = (req.body ?? {}) as Record<string, unknown>;
  const query = (req.query ?? {}) as Record<string, unknown>;
  return { ...query, ...body };
};

export const payuWebhookRoutes = async (app: FastifyInstance) => {
  app.addContentTypeParser(
    "application/x-www-form-urlencoded",
    { parseAs: "string" },
    (_req, body, done) => {
      try {
        const params = new URLSearchParams(body as string);
        const out: Record<string, string> = {};
        for (const [k, v] of params.entries()) out[k] = v;
        done(null, out);
      } catch (err) {
        done(err as Error, undefined);
      }
    }
  );

  const handlePayuReturn = async (req: FastifyRequest, reply: FastifyReply) => {
    const raw = collectPayuFields(req);
    const fields = parsePayuResponseBody(raw);
    if (!fields) {
      return reply.code(400).send({
        error: { code: "invalid_payload", message: "Missing PayU response fields." },
      });
    }

    const creds = await getPayuCredentials();
    if (!creds) {
      return reply.code(503).send({
        error: { code: "payu_not_configured", message: "PayU is not configured." },
      });
    }

    const intentId = fields.udf1?.trim();
    if (!intentId) {
      return reply.code(400).send({
        error: { code: "missing_intent", message: "PayU udf1 (intent id) missing." },
      });
    }

    if (fields.status.toLowerCase() !== "success") {
      await logSystemError("payu", "return", `PayU payment ${fields.status}`, {
        txnid: fields.txnid,
        intentId,
      }, intentId);
      const failUrl = `${config.storefrontOrigin}/checkout?payu=failed&intent=${encodeURIComponent(intentId)}`;
      return reply.redirect(failUrl);
    }

    const result = await confirmPayuPaymentIntentById(intentId, fields, creds);
    if (!result.ok) {
      await logSystemError("payu", "return", result.message, {
        code: result.code,
        txnid: fields.txnid,
        intentId,
      }, intentId);
      const failUrl = `${config.storefrontOrigin}/checkout?payu=error&code=${encodeURIComponent(result.code)}`;
      return reply.redirect(failUrl);
    }

    await logSystemInfo("payu", "return", "Storefront order confirmed after PayU payment", {
      intentId,
      soNo: result.response.salesOrder.soNo,
      txnid: fields.txnid,
    }, result.response.salesOrder.soNo);

    return reply.redirect(
      `${config.storefrontOrigin}/order/${result.response.salesOrder.soNo}?paid=1`
    );
  };

  app.post("/storefront-mock/order/payu/return", handlePayuReturn);
  app.get("/storefront-mock/order/payu/return", handlePayuReturn);

  app.post("/webhooks/payu", async (req, reply) => {
    const raw = collectPayuFields(req);
    const fields = parsePayuResponseBody(raw);
    if (!fields) {
      return reply.code(400).send({ error: { code: "invalid_payload" } });
    }

    const creds = await getPayuCredentials();
    if (!creds) {
      return reply.code(503).send({ error: { code: "payu_not_configured" } });
    }

    if (!verifyPayuResponseHash(creds, fields)) {
      return reply.code(400).send({ error: { code: "invalid_hash" } });
    }

    const intentId = fields.udf1?.trim();
    if (!intentId) {
      return reply.code(400).send({ error: { code: "missing_intent" } });
    }

    if (fields.status.toLowerCase() === "success") {
      await confirmPayuPaymentIntentById(intentId, fields, creds, { trustedWebhook: true });
    } else if (fields.status.toLowerCase() === "failure") {
      await db.paymentIntent.updateMany({
        where: { gatewayOrderId: fields.txnid, status: "created" },
        data: { status: "failed", gatewayPaymentId: fields.mihpayid ?? null },
      });
    }

    return { ok: true };
  });
};
