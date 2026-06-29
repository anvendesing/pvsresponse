import { db } from "../db.js";

export type SmsCreds = {
  username: string;
  password: string;
  senderId: string;
  templateText: string;
};

export async function getSmsCreds(): Promise<SmsCreds | null> {
  const row = await db.smsProviderConfig.findUnique({ where: { id: "default" } });
  const username = row?.username ?? process.env.SMSIDEA_USERNAME ?? null;
  const password = row?.password ?? process.env.SMSIDEA_PASSWORD ?? null;
  const senderId = row?.senderId ?? process.env.SMSIDEA_SENDER ?? null;
  const templateText =
    row?.templateText ??
    process.env.SMSIDEA_TEMPLATE ??
    "Your PVS verification code is {otp}. Valid for 10 minutes.";

  if (!username || !password || !senderId) return null;
  if (row && !row.active && process.env.NODE_ENV === "production") return null;
  return { username, password, senderId, templateText };
}

export function formatOtpMessage(template: string, otp: string): string {
  return template.replace(/\{otp\}/g, otp);
}

export async function sendSms(
  to: string,
  body: string
): Promise<{ ok: boolean; ref?: string; error?: string }> {
  const creds = await getSmsCreds();
  if (!creds) {
    return { ok: false, error: "sms_not_configured" };
  }

  const mobile = to.replace(/\D/g, "");
  const params = new URLSearchParams({
    mobile,
    pass: creds.password,
    senderid: creds.senderId,
    msg: body,
    user: creds.username,
  });

  try {
    const url = `https://sms.smsidea.co.in/sendsms.aspx?${params.toString()}`;
    const res = await fetch(url, { method: "GET" });
    const text = (await res.text()).trim();
    if (!res.ok) {
      return { ok: false, error: text || `HTTP ${res.status}` };
    }
    return { ok: true, ref: text };
  } catch (err) {
    const msg = err instanceof Error ? err.message : "send_failed";
    return { ok: false, error: msg };
  }
}

export async function sendOtpSms(
  phone: string,
  otp: string,
  purpose: string
): Promise<{ ok: boolean; devMode: boolean; ref?: string; error?: string }> {
  const creds = await getSmsCreds();
  if (!creds) {
    console.info(`[OTP dev] phone=${phone} purpose=${purpose} code=${otp}`);
    await db.devOtpLog.create({
      data: { phone, purpose, code: otp },
    });
    return { ok: true, devMode: true };
  }

  const body = formatOtpMessage(creds.templateText, otp);
  const result = await sendSms(phone, body);
  return { ...result, devMode: false };
}

export function maskSmsConfig(row: {
  id: string;
  provider: string;
  mode: string;
  username: string | null;
  password: string | null;
  senderId: string | null;
  templateId: string | null;
  templateText: string | null;
  active: boolean;
  createdAt: Date;
  updatedAt: Date;
}) {
  const mask = (v: string | null) =>
    v && v.length > 4 ? `${v.slice(0, 2)}${"*".repeat(Math.min(v.length - 4, 8))}${v.slice(-2)}` : v;
  return {
    ...row,
    password: row.password ? mask(row.password) : null,
    hasPassword: Boolean(row.password),
  };
}
