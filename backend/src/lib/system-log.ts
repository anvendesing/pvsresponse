import { db } from "../db.js";

export type SystemLogLevel = "error" | "warn" | "info";
export type SystemLogSource =
  | "shiprocket"
  | "storefront"
  | "razorpay"
  | "payu"
  | "otp"
  | "sms"
  | "billing";

const REDACT_KEYS = /password|secret|token|authorization|keysecret|otp|code|signature/i;

const sanitize = (value: unknown, depth = 0): unknown => {
  if (depth > 6) return "[truncated]";
  if (value === null || value === undefined) return value;
  if (typeof value === "string") {
    return value.length > 4000 ? `${value.slice(0, 4000)}…` : value;
  }
  if (typeof value !== "object") return value;
  if (Array.isArray(value)) return value.slice(0, 50).map((v) => sanitize(v, depth + 1));
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
    out[k] = REDACT_KEYS.test(k) ? "[redacted]" : sanitize(v, depth + 1);
  }
  return out;
};

export async function logSystemEvent(params: {
  level: SystemLogLevel;
  source: SystemLogSource;
  action: string;
  message: string;
  context?: unknown;
  refId?: string | null;
}): Promise<void> {
  try {
    await db.systemEventLog.create({
      data: {
        level: params.level,
        source: params.source,
        action: params.action,
        message: params.message.slice(0, 2000),
        context: params.context ? JSON.stringify(sanitize(params.context)) : null,
        refId: params.refId ?? null,
      },
    });
  } catch (err) {
    console.warn("[SystemEventLog] write failed:", (err as Error).message);
  }
}

export async function logSystemError(
  source: SystemLogSource,
  action: string,
  message: string,
  context?: unknown,
  refId?: string | null
) {
  await logSystemEvent({ level: "error", source, action, message, context, refId });
}

export async function logSystemInfo(
  source: SystemLogSource,
  action: string,
  message: string,
  context?: unknown,
  refId?: string | null
) {
  await logSystemEvent({ level: "info", source, action, message, context, refId });
}

export async function logSystemWarn(
  source: SystemLogSource,
  action: string,
  message: string,
  context?: unknown,
  refId?: string | null
) {
  await logSystemEvent({ level: "warn", source, action, message, context, refId });
}
