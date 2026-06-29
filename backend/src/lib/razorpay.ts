import Razorpay from "razorpay";
import { createHmac, timingSafeEqual } from "crypto";
import { db } from "../db.js";

export type RazorpayCredentials = {
  keyId: string;
  keySecret: string;
  webhookSecret: string | null;
  mode: "test" | "live";
};

const maskSecret = (value: string | null | undefined): string | null => {
  if (!value) return null;
  if (value.length <= 4) return "****";
  return `${"*".repeat(Math.min(value.length - 4, 12))}${value.slice(-4)}`;
};

export const maskGatewayConfig = (row: {
  id: string;
  gateway: string;
  mode: string;
  keyId: string | null;
  keySecret: string | null;
  webhookSecret: string | null;
  active: boolean;
  updatedAt: Date;
}) => ({
  id: row.id,
  gateway: row.gateway,
  mode: row.mode,
  keyId: row.keyId,
  keySecret: maskSecret(row.keySecret),
  webhookSecret: maskSecret(row.webhookSecret),
  active: row.active,
  updatedAt: row.updatedAt,
});

export async function getRazorpayCredentials(): Promise<RazorpayCredentials | null> {
  const row = await db.paymentGatewayConfig.findUnique({
    where: { gateway: "razorpay" },
  });
  if (row?.active && row.keyId && row.keySecret) {
    return {
      keyId: row.keyId,
      keySecret: row.keySecret,
      webhookSecret: row.webhookSecret,
      mode: row.mode === "live" ? "live" : "test",
    };
  }
  const keyId = process.env.RAZORPAY_KEY_ID?.trim();
  const keySecret = process.env.RAZORPAY_KEY_SECRET?.trim();
  if (!keyId || !keySecret) return null;
  return {
    keyId,
    keySecret,
    webhookSecret: process.env.RAZORPAY_WEBHOOK_SECRET?.trim() ?? null,
    mode: keyId.startsWith("rzp_live_") ? "live" : "test",
  };
}

export async function getRazorpayClient(): Promise<{
  client: Razorpay;
  creds: RazorpayCredentials;
} | null> {
  const creds = await getRazorpayCredentials();
  if (!creds) return null;
  return {
    creds,
    client: new Razorpay({ key_id: creds.keyId, key_secret: creds.keySecret }),
  };
}

export function verifyCheckoutSignature(
  orderId: string,
  paymentId: string,
  signature: string,
  secret: string
): boolean {
  const expected = createHmac("sha256", secret)
    .update(`${orderId}|${paymentId}`)
    .digest("hex");
  try {
    return timingSafeEqual(Buffer.from(expected), Buffer.from(signature));
  } catch {
    return false;
  }
}

export function verifyWebhookSignature(
  rawBody: string,
  signature: string,
  secret: string
): boolean {
  const expected = createHmac("sha256", secret).update(rawBody).digest("hex");
  try {
    return timingSafeEqual(Buffer.from(expected), Buffer.from(signature));
  } catch {
    return false;
  }
}

export function inrToPaise(amountInr: number): number {
  return Math.round(amountInr * 100);
}
