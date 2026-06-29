import { createHash, timingSafeEqual } from "crypto";
import { db } from "../db.js";

export type PayuCredentials = {
  merchantKey: string;
  salt: string;
  mode: "test" | "live";
};

export async function getPayuCredentials(): Promise<PayuCredentials | null> {
  const row = await db.paymentGatewayConfig.findUnique({
    where: { gateway: "payu" },
  });
  if (row?.active && row.keyId && row.keySecret) {
    return {
      merchantKey: row.keyId,
      salt: row.keySecret,
      mode: row.mode === "live" ? "live" : "test",
    };
  }
  const merchantKey = process.env.PAYU_MERCHANT_KEY?.trim();
  const salt = process.env.PAYU_SALT?.trim();
  if (!merchantKey || !salt) return null;
  const modeEnv = process.env.PAYU_MODE?.trim().toLowerCase();
  return {
    merchantKey,
    salt,
    mode: modeEnv === "live" ? "live" : "test",
  };
}

export function payuCheckoutUrl(mode: "test" | "live"): string {
  return mode === "live"
    ? "https://secure.payu.in/_payment"
    : "https://test.payu.in/_payment";
}

/** Format INR amount for PayU hash / form fields. */
export function formatPayuAmount(amountInr: number): string {
  return amountInr.toFixed(2);
}

export function generatePayuTxnId(): string {
  const raw = `PV${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`;
  return raw.replace(/[^a-zA-Z0-9]/g, "").slice(0, 25);
}

export function buildPayuRequestHash(args: {
  key: string;
  salt: string;
  txnid: string;
  amount: string;
  productinfo: string;
  firstname: string;
  email: string;
  udf1?: string;
  udf2?: string;
  udf3?: string;
  udf4?: string;
  udf5?: string;
}): string {
  const udf1 = args.udf1 ?? "";
  const udf2 = args.udf2 ?? "";
  const udf3 = args.udf3 ?? "";
  const udf4 = args.udf4 ?? "";
  const udf5 = args.udf5 ?? "";
  const seq = `${args.key}|${args.txnid}|${args.amount}|${args.productinfo}|${args.firstname}|${args.email}|${udf1}|${udf2}|${udf3}|${udf4}|${udf5}||||||${args.salt}`;
  return createHash("sha512").update(seq).digest("hex");
}

export type PayuResponseFields = {
  status: string;
  txnid: string;
  amount: string;
  productinfo: string;
  firstname: string;
  email: string;
  mihpayid?: string;
  hash: string;
  udf1?: string;
  udf2?: string;
  udf3?: string;
  udf4?: string;
  udf5?: string;
};

export function verifyPayuResponseHash(
  creds: PayuCredentials,
  fields: PayuResponseFields
): boolean {
  const udf1 = fields.udf1 ?? "";
  const udf2 = fields.udf2 ?? "";
  const udf3 = fields.udf3 ?? "";
  const udf4 = fields.udf4 ?? "";
  const udf5 = fields.udf5 ?? "";
  const seq = `${creds.salt}|${fields.status}||||||${udf5}|${udf4}|${udf3}|${udf2}|${udf1}|${fields.email}|${fields.firstname}|${fields.productinfo}|${fields.amount}|${fields.txnid}|${creds.merchantKey}`;
  const expected = createHash("sha512").update(seq).digest("hex");
  try {
    return timingSafeEqual(Buffer.from(expected), Buffer.from(fields.hash));
  } catch {
    return false;
  }
}

export function parsePayuResponseBody(
  body: Record<string, unknown>
): PayuResponseFields | null {
  const status = String(body.status ?? "").trim();
  const txnid = String(body.txnid ?? "").trim();
  const amount = String(body.amount ?? "").trim();
  const productinfo = String(body.productinfo ?? "").trim();
  const firstname = String(body.firstname ?? "").trim();
  const email = String(body.email ?? "").trim();
  const hash = String(body.hash ?? "").trim();
  if (!status || !txnid || !amount || !hash) return null;
  return {
    status,
    txnid,
    amount,
    productinfo,
    firstname,
    email,
    mihpayid: body.mihpayid != null ? String(body.mihpayid) : undefined,
    hash,
    udf1: body.udf1 != null ? String(body.udf1) : undefined,
    udf2: body.udf2 != null ? String(body.udf2) : undefined,
    udf3: body.udf3 != null ? String(body.udf3) : undefined,
    udf4: body.udf4 != null ? String(body.udf4) : undefined,
    udf5: body.udf5 != null ? String(body.udf5) : undefined,
  };
}
