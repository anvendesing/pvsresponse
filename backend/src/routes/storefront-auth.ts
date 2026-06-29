import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import { z } from "zod";
import { db } from "../db.js";
import {
  checkSendRateLimit,
  consumeOtpToken,
  createOtpToken,
  isPhoneLocked,
  OTP_RESEND_COOLDOWN_SEC,
  validateOtp,
  type OtpPurpose,
} from "../lib/otp.js";
import { normalizePhone } from "../lib/phone.js";
import { sendOtpSms } from "../lib/smsidea.js";
import { signStorefrontToken } from "../lib/storefront-jwt.js";
import {
  findOrCreateCustomerByPhone,
  mapAddress,
  mirrorDefaultAddressToCustomer,
  requireStorefrontAuth,
  serializeCustomerOrders,
} from "../lib/storefront-customer.js";
import { computeAddressDistanceFields } from "../lib/address-distance.js";
import { lookupPincodePlace } from "../lib/pincode-lookup.js";
import { pincodeSchema } from "../lib/customer-address.js";
import { recordActivityNow } from "../lib/customer-activity.js";

const sendSchema = z.object({
  phone: z.string().trim().min(6).max(20),
  purpose: z.enum(["login", "track"]).default("login"),
});

const verifySchema = z.object({
  phone: z.string().trim().min(6).max(20),
  code: z.string().trim().length(6),
  purpose: z.enum(["login", "track"]).default("login"),
  name: z.string().trim().max(120).optional(),
});

const addressSchema = z.object({
  label: z.string().trim().max(40).optional(),
  name: z.string().trim().min(1).max(120),
  phone: z.string().trim().min(6).max(20),
  addressLine: z.string().trim().min(1).max(200),
  city: z.string().trim().min(1).max(80),
  state: z.string().trim().max(80).optional(),
  pincode: pincodeSchema,
  isDefault: z.boolean().optional(),
});

const addressPatchSchema = z.object({
  label: z.string().trim().max(40).optional(),
  name: z.string().trim().min(1).max(120).optional(),
  phone: z.string().trim().min(6).max(20).optional(),
  addressLine: z.string().trim().min(1).max(200).optional(),
  city: z.string().trim().min(1).max(80).optional(),
  state: z.string().trim().max(80).optional(),
  pincode: pincodeSchema.optional(),
  isDefault: z.boolean().optional(),
});

const profileUpdateSchema = z.object({
  name: z.string().trim().min(1).max(120).optional(),
  email: z.string().trim().toLowerCase().email().optional().or(z.literal("")),
});

export const storefrontAuthRoutes = async (app: FastifyInstance) => {
  app.post("/storefront-auth/otp/send", async (req, reply) => {
    const body = sendSchema.parse(req.body);
    const phone = normalizePhone(body.phone);
    if (!phone) {
      return { ok: true, expiresInSec: 600, attemptsLeft: 3 };
    }

    const purpose = body.purpose as OtpPurpose;
    if (await isPhoneLocked(phone, purpose)) {
      return reply.code(429).send({
        error: { code: "locked", message: "Too many failed attempts. Try again in 15 minutes." },
      });
    }

    const rate = await checkSendRateLimit(phone, purpose);
    if (!rate.ok) {
      return reply.code(429).send({
        error: {
          code: "rate_limited",
          message: "Too many OTP requests. Please wait before retrying.",
          retryAfterSec: rate.retryAfterSec,
        },
      });
    }

    const { code, expiresInSec } = await createOtpToken(phone, purpose);
    const sms = await sendOtpSms(phone, code, purpose);

    const response: Record<string, unknown> = {
      ok: true,
      expiresInSec,
      resendInSec: OTP_RESEND_COOLDOWN_SEC,
      attemptsLeft: rate.attemptsLeft,
    };
    if (sms.devMode) {
      response.devOtp = code;
    }
    return response;
  });

  app.post("/storefront-auth/otp/verify", async (req, reply) => {
    const body = verifySchema.parse(req.body);
    const phone = normalizePhone(body.phone);
    if (!phone) {
      return reply.code(400).send({ error: { code: "invalid_phone", message: "Invalid mobile number." } });
    }

    const purpose = body.purpose as OtpPurpose;
    const result = await validateOtp(phone, purpose, body.code);
    if (!result.ok) {
      const messages: Record<string, string> = {
        invalid: "Invalid OTP.",
        expired: "OTP expired or already used. Request a new code.",
        locked: "Too many failed attempts. Try again in 15 minutes.",
        max_attempts: "Incorrect OTP.",
      };
      return reply.code(400).send({
        error: { code: result.reason, message: messages[result.reason] ?? "Verification failed." },
      });
    }

    let account;
    try {
      account = await findOrCreateCustomerByPhone(phone, body.name);
    } catch (err) {
      req.log.error(err, "findOrCreateCustomerByPhone failed after OTP validated");
      return reply.code(500).send({
        error: {
          code: "account_create_failed",
          message: "Could not finish sign-in. Please try the same OTP again.",
        },
      });
    }

    await consumeOtpToken(result.tokenId);
    const addresses = await db.customerAddress.findMany({
      where: { customerId: account.customerId },
      orderBy: [{ isDefault: "desc" }, { updatedAt: "desc" }],
    });
    const recentOrders = await serializeCustomerOrders(account.customerId, 10);
    const token = signStorefrontToken({ sub: account.id, phone });

    // Record server-side login event so pre-login anon pageviews can be
    // stitched to this customer even if the frontend event is lost.
    const anonId = (req.headers["x-pv-anon-id"] as string | undefined)?.slice(0, 64);
    if (anonId) {
      void recordActivityNow({
        anonId,
        customerId: account.customerId,
        event: "login",
        ip: (req.headers["x-forwarded-for"] as string | undefined)?.split(",")[0]?.trim() ?? req.ip ?? null,
        userAgent: (req.headers["user-agent"] as string | undefined)?.slice(0, 200) ?? null,
      });
    }

    return {
      token,
      customer: {
        id: account.customerId,
        accountId: account.id,
        name: account.customer.name,
        email: account.email,
        phone: account.phone,
      },
      addresses: addresses.map(mapAddress),
      recentOrders,
    };
  });

  app.get("/storefront-auth/me", async (req, reply) => {
    const user = await requireStorefrontAuth(req, reply);
    if (!user) return;

    const account = await db.customerAccount.findUnique({
      where: { id: user.accountId },
      include: { customer: true },
    });
    if (!account) {
      return reply.code(404).send({ error: { code: "not_found" } });
    }

    const addresses = await db.customerAddress.findMany({
      where: { customerId: user.customerId },
      orderBy: [{ isDefault: "desc" }, { updatedAt: "desc" }],
    });

    return {
      customer: {
        id: account.customerId,
        accountId: account.id,
        name: account.customer.name,
        email: account.email,
        phone: account.phone,
      },
      addresses: addresses.map(mapAddress),
    };
  });

  app.patch("/storefront-auth/me", async (req, reply) => {
    const user = await requireStorefrontAuth(req, reply);
    if (!user) return;
    const body = profileUpdateSchema.parse(req.body);

    const account = await db.customerAccount.findUnique({
      where: { id: user.accountId },
      include: { customer: true },
    });
    if (!account) {
      return reply.code(404).send({ error: { code: "not_found" } });
    }

    if (body.name) {
      await db.customer.update({
        where: { id: user.customerId },
        data: { name: body.name.trim() },
      });
    }
    if (body.email !== undefined) {
      await db.customerAccount.update({
        where: { id: user.accountId },
        data: { email: body.email ? body.email : null },
      });
    }

    const updated = await db.customerAccount.findUnique({
      where: { id: user.accountId },
      include: { customer: true },
    });
    const addresses = await db.customerAddress.findMany({
      where: { customerId: user.customerId },
      orderBy: [{ isDefault: "desc" }, { updatedAt: "desc" }],
    });

    return {
      customer: {
        id: updated!.customerId,
        accountId: updated!.id,
        name: updated!.customer.name,
        email: updated!.email,
        phone: updated!.phone,
      },
      addresses: addresses.map(mapAddress),
    };
  });

  app.post("/storefront-auth/logout", async () => ({ ok: true }));

  // Address book (Bearer-guarded)
  app.get("/storefront-auth/addresses", async (req, reply) => {
    const user = await requireStorefrontAuth(req, reply);
    if (!user) return;
    const rows = await db.customerAddress.findMany({
      where: { customerId: user.customerId },
      orderBy: [{ isDefault: "desc" }, { updatedAt: "desc" }],
    });
    return rows.map(mapAddress);
  });

  app.post("/storefront-auth/addresses", async (req, reply) => {
    const user = await requireStorefrontAuth(req, reply);
    if (!user) return;
    const body = addressSchema.parse(req.body);
    const phone = normalizePhone(body.phone) ?? body.phone.trim();
    const makeDefault = body.isDefault ?? false;
    const place = await lookupPincodePlace(body.pincode);
    const distance = place
      ? { distanceKm: place.distanceKm, dispatchPincode: place.dispatchPincode }
      : await computeAddressDistanceFields(body.pincode);

    const created = await db.$transaction(async (tx) => {
      if (makeDefault) {
        await tx.customerAddress.updateMany({
          where: { customerId: user.customerId },
          data: { isDefault: false },
        });
      }
      const count = await tx.customerAddress.count({ where: { customerId: user.customerId } });
      const isDefault = makeDefault || count === 0;
      const row = await tx.customerAddress.create({
        data: {
          customerId: user.customerId,
          label: body.label ?? null,
          name: body.name,
          phone,
          addressLine: body.addressLine,
          city: body.city,
          district: place?.district ?? null,
          state: body.state ?? null,
          pincode: body.pincode,
          distanceKm: distance.distanceKm,
          dispatchPincode: distance.dispatchPincode,
          isDefault,
        },
      });
      if (isDefault) {
        await mirrorDefaultAddressToCustomer(user.customerId, row, tx);
      }
      return row;
    });

    return reply.code(201).send(mapAddress(created));
  });

  app.patch("/storefront-auth/addresses/:id", async (req, reply) => {
    const user = await requireStorefrontAuth(req, reply);
    if (!user) return;
    const id = (req.params as { id: string }).id;
    const body = addressPatchSchema.parse(req.body);

    const existing = await db.customerAddress.findFirst({
      where: { id, customerId: user.customerId },
    });
    if (!existing) {
      return reply.code(404).send({ error: { code: "not_found" } });
    }

    const nextPincode = body.pincode ?? existing.pincode;
    const place =
      body.pincode !== undefined ? await lookupPincodePlace(nextPincode) : null;
    const distance =
      body.pincode !== undefined
        ? place
          ? { distanceKm: place.distanceKm, dispatchPincode: place.dispatchPincode }
          : await computeAddressDistanceFields(nextPincode)
        : {
            distanceKm: existing.distanceKm,
            dispatchPincode: existing.dispatchPincode,
          };

    const updated = await db.$transaction(async (tx) => {
      if (body.isDefault) {
        await tx.customerAddress.updateMany({
          where: { customerId: user.customerId },
          data: { isDefault: false },
        });
      }
      const row = await tx.customerAddress.update({
        where: { id },
        data: {
          label: body.label !== undefined ? body.label ?? null : undefined,
          name: body.name,
          phone: body.phone ? normalizePhone(body.phone) ?? body.phone.trim() : undefined,
          addressLine: body.addressLine,
          city: body.city,
          district:
            body.pincode !== undefined ? place?.district ?? existing.district : undefined,
          state: body.state !== undefined ? body.state ?? null : undefined,
          pincode: body.pincode,
          distanceKm: body.pincode !== undefined ? distance.distanceKm : undefined,
          dispatchPincode: body.pincode !== undefined ? distance.dispatchPincode : undefined,
          isDefault: body.isDefault,
        },
      });
      if (row.isDefault) {
        await mirrorDefaultAddressToCustomer(user.customerId, row, tx);
      }
      return row;
    });

    return mapAddress(updated);
  });

  app.delete("/storefront-auth/addresses/:id", async (req, reply) => {
    const user = await requireStorefrontAuth(req, reply);
    if (!user) return;
    const id = (req.params as { id: string }).id;
    const existing = await db.customerAddress.findFirst({
      where: { id, customerId: user.customerId },
    });
    if (!existing) {
      return reply.code(404).send({ error: { code: "not_found" } });
    }
    await db.customerAddress.delete({ where: { id } });
    if (existing.isDefault) {
      const next = await db.customerAddress.findFirst({
        where: { customerId: user.customerId },
        orderBy: { updatedAt: "desc" },
      });
      if (next) {
        await db.customerAddress.update({ where: { id: next.id }, data: { isDefault: true } });
      }
    }
    return { ok: true };
  });

  app.post("/storefront-auth/addresses/:id/default", async (req, reply) => {
    const user = await requireStorefrontAuth(req, reply);
    if (!user) return;
    const id = (req.params as { id: string }).id;
    const existing = await db.customerAddress.findFirst({
      where: { id, customerId: user.customerId },
    });
    if (!existing) {
      return reply.code(404).send({ error: { code: "not_found" } });
    }
    await db.$transaction(async (tx) => {
      await tx.customerAddress.updateMany({
        where: { customerId: user.customerId },
        data: { isDefault: false },
      });
      const row = await tx.customerAddress.update({ where: { id }, data: { isDefault: true } });
      await mirrorDefaultAddressToCustomer(user.customerId, row, tx);
    });
    return { ok: true };
  });
};
