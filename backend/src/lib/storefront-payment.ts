import { db } from "../db.js";
import { getPayuCredentials } from "./payu.js";
import { getRazorpayCredentials } from "./razorpay.js";

export type StorefrontPaymentGateway = "razorpay" | "payu";

const STOREFront_GATEWAYS: StorefrontPaymentGateway[] = ["payu", "razorpay"];

export async function listActiveStorefrontGateways(): Promise<StorefrontPaymentGateway[]> {
  const rows = await db.paymentGatewayConfig.findMany({
    where: { active: true, gateway: { in: STOREFront_GATEWAYS } },
    select: { gateway: true },
  });
  const active = new Set(rows.map((r) => r.gateway));
  return STOREFront_GATEWAYS.filter((g) => active.has(g));
}

export async function resolveStorefrontGateway(
  requested?: string | null
): Promise<
  | { ok: true; gateway: StorefrontPaymentGateway }
  | { ok: false; code: string; message: string }
> {
  const active = await listActiveStorefrontGateways();
  if (active.length === 0) {
    return {
      ok: false,
      code: "no_payment_gateway",
      message:
        "No payment gateway is active. Enable PayU or Razorpay in Settings → Integrations.",
    };
  }

  if (requested) {
    if (!STOREFront_GATEWAYS.includes(requested as StorefrontPaymentGateway)) {
      return { ok: false, code: "invalid_gateway", message: "Unknown payment gateway." };
    }
    if (!active.includes(requested as StorefrontPaymentGateway)) {
      return {
        ok: false,
        code: "gateway_inactive",
        message: `${requested} is not active. Enable it in Settings or choose another gateway.`,
      };
    }
    return { ok: true, gateway: requested as StorefrontPaymentGateway };
  }

  if (active.length === 1) {
    return { ok: true, gateway: active[0]! };
  }

  return {
    ok: false,
    code: "gateway_required",
    message: "Multiple payment gateways are active. Pass gateway: payu or razorpay.",
  };
}

export async function isGatewayConfigured(
  gateway: StorefrontPaymentGateway
): Promise<boolean> {
  if (gateway === "razorpay") return (await getRazorpayCredentials()) !== null;
  return (await getPayuCredentials()) !== null;
}
