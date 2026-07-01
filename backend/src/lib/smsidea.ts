import { db } from "../db.js";
import { normalizePhone } from "./phone.js";
import { logSystemError, logSystemInfo } from "./system-log.js";
import {
  applyDltVariables,
  DLT_SENDER_ID,
  DLT_TEMPLATES,
  otpTemplateFromLegacy,
} from "./dlt-templates.js";

export type SmsCreds = {
  username: string;
  password: string;
  senderId: string;
  peid: string | null;
  otpTemplateId: string;
  otpTemplateText: string;
  orderTemplateId: string;
  orderTemplateText: string;
};

const SMS_API = "https://www.smsidea.co.in/smsstatuswithid.aspx";

const storefrontSiteUrl = (): string =>
  process.env.STOREFRONT_URL?.trim() ||
  process.env.VITE_STOREFRONT_URL?.trim() ||
  "prakruthivanam.com";

export async function getSmsCreds(): Promise<SmsCreds | null> {
  const row = await db.smsProviderConfig.findUnique({ where: { id: "default" } });
  const username = row?.username ?? process.env.SMSIDEA_USERNAME ?? null;
  const password = row?.password ?? process.env.SMSIDEA_PASSWORD ?? null;
  const senderId = row?.senderId ?? process.env.SMSIDEA_SENDER ?? DLT_SENDER_ID;
  const peid = row?.peid ?? process.env.SMSIDEA_PEID ?? null;

  const otpTemplateId =
    row?.templateId ?? process.env.SMSIDEA_OTP_TEMPLATE_ID ?? DLT_TEMPLATES.otp.templateId;
  const otpTemplateText = otpTemplateFromLegacy(
    row?.templateText ??
      process.env.SMSIDEA_OTP_TEMPLATE ??
      DLT_TEMPLATES.otp.content
  );

  const orderTemplateId =
    row?.orderTemplateId ??
    process.env.SMSIDEA_ORDER_TEMPLATE_ID ??
    DLT_TEMPLATES.orderConfirm.templateId;
  const orderTemplateText =
    row?.orderTemplateText ??
    process.env.SMSIDEA_ORDER_TEMPLATE ??
    DLT_TEMPLATES.orderConfirm.content;

  if (!username || !password || !senderId) return null;
  if (row && !row.active && process.env.NODE_ENV === "production") return null;
  return {
    username,
    password,
    senderId,
    peid,
    otpTemplateId,
    otpTemplateText,
    orderTemplateId,
    orderTemplateText,
  };
}

function smsRecipient(raw: string): string | null {
  return normalizePhone(raw);
}

export async function sendDltSms(input: {
  to: string;
  templateId: string;
  templateText: string;
  variables: string[];
  logAction: string;
  refId?: string;
}): Promise<{ ok: boolean; ref?: string; error?: string }> {
  const creds = await getSmsCreds();
  if (!creds) {
    return { ok: false, error: "sms_not_configured" };
  }

  const to = smsRecipient(input.to);
  if (!to) {
    return { ok: false, error: "invalid_phone" };
  }

  const msg = applyDltVariables(input.templateText, input.variables);
  const params = new URLSearchParams({
    mobile: creds.username,
    pass: creds.password,
    senderid: creds.senderId,
    to,
    msg,
    templateid: input.templateId,
  });
  if (creds.peid) params.set("peid", creds.peid);

  try {
    const res = await fetch(`${SMS_API}?${params.toString()}`, { method: "GET" });
    const text = (await res.text()).trim();
    const ok = res.ok && !/^error/i.test(text) && !/^00[17]\b/.test(text);
    if (!ok) {
      await logSystemError("sms", input.logAction, text || `HTTP ${res.status}`, {
        to: to.slice(0, 4) + "******",
        templateId: input.templateId,
      }, input.refId);
      return { ok: false, error: text || `HTTP ${res.status}` };
    }
    await logSystemInfo("sms", input.logAction, "DLT SMS sent", {
      templateId: input.templateId,
      ref: text.slice(0, 80),
    }, input.refId);
    return { ok: true, ref: text };
  } catch (err) {
    const message = err instanceof Error ? err.message : "send_failed";
    await logSystemError("sms", input.logAction, message, undefined, input.refId);
    return { ok: false, error: message };
  }
}

/** Plain SMS (admin test) — still passes DLT template id when configured. */
export async function sendSms(
  to: string,
  body: string,
  templateId?: string
): Promise<{ ok: boolean; ref?: string; error?: string }> {
  const creds = await getSmsCreds();
  if (!creds) {
    return { ok: false, error: "sms_not_configured" };
  }

  const recipient = smsRecipient(to);
  if (!recipient) {
    return { ok: false, error: "invalid_phone" };
  }

  const params = new URLSearchParams({
    mobile: creds.username,
    pass: creds.password,
    senderid: creds.senderId,
    to: recipient,
    msg: body,
  });
  const tid = templateId ?? creds.otpTemplateId;
  if (tid) params.set("templateid", tid);
  if (creds.peid) params.set("peid", creds.peid);

  try {
    const res = await fetch(`${SMS_API}?${params.toString()}`, { method: "GET" });
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

  const result = await sendDltSms({
    to: phone,
    templateId: creds.otpTemplateId,
    templateText: creds.otpTemplateText,
    variables: [otp],
    logAction: "otp_send",
    refId: purpose,
  });
  return { ...result, devMode: false };
}

export async function sendOrderConfirmSms(
  phone: string,
  orderRef: string
): Promise<{ ok: boolean; devMode: boolean; ref?: string; error?: string }> {
  const creds = await getSmsCreds();
  if (!creds) {
    console.info(`[SMS dev] order confirm phone=${phone} ref=${orderRef}`);
    return { ok: true, devMode: true };
  }

  const result = await sendDltSms({
    to: phone,
    templateId: creds.orderTemplateId,
    templateText: creds.orderTemplateText,
    variables: [orderRef, storefrontSiteUrl()],
    logAction: "order_confirm",
    refId: orderRef,
  });
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
  orderTemplateId?: string | null;
  orderTemplateText?: string | null;
  peid?: string | null;
  active: boolean;
  createdAt: Date;
  updatedAt: Date;
}) {
  const mask = (v: string | null | undefined) =>
    v && v.length > 4
      ? `${v.slice(0, 2)}${"*".repeat(Math.min(v.length - 4, 8))}${v.slice(-2)}`
      : (v ?? null);
  return {
    ...row,
    password: row.password ? mask(row.password) : null,
    peid: row.peid ? mask(row.peid) : null,
    hasPassword: Boolean(row.password),
  };
}
