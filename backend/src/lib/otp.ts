import bcrypt from "bcryptjs";
import { db } from "../db.js";
import { normalizePhone } from "./phone.js";

export type OtpPurpose = "login" | "track";

const OTP_TTL_MS = 10 * 60 * 1000;
const MAX_SENDS_PER_WINDOW = 3;
const SEND_WINDOW_MS = 10 * 60 * 1000;
const MAX_VERIFY_ATTEMPTS = 5;
const LOCKOUT_MS = 15 * 60 * 1000;

export function generateOtp(): string {
  return String(Math.floor(100000 + Math.random() * 900000));
}

export async function hashOtp(code: string, phone: string): Promise<string> {
  return bcrypt.hash(`${phone}:${code}`, 10);
}

export async function verifyOtpHash(code: string, phone: string, hash: string): Promise<boolean> {
  return bcrypt.compare(`${phone}:${code}`, hash);
}

export async function checkSendRateLimit(
  phone: string,
  purpose: OtpPurpose
): Promise<{ ok: true; attemptsLeft: number } | { ok: false; retryAfterSec: number }> {
  const since = new Date(Date.now() - SEND_WINDOW_MS);
  const recent = await db.otpToken.count({
    where: { phone, purpose, createdAt: { gte: since } },
  });
  if (recent >= MAX_SENDS_PER_WINDOW) {
    const oldest = await db.otpToken.findFirst({
      where: { phone, purpose, createdAt: { gte: since } },
      orderBy: { createdAt: "asc" },
    });
    const retryAfterSec = oldest
      ? Math.ceil((oldest.createdAt.getTime() + SEND_WINDOW_MS - Date.now()) / 1000)
      : 600;
    return { ok: false, retryAfterSec: Math.max(retryAfterSec, 1) };
  }
  return { ok: true, attemptsLeft: MAX_SENDS_PER_WINDOW - recent - 1 };
}

export async function isPhoneLocked(phone: string, purpose: OtpPurpose): Promise<boolean> {
  const since = new Date(Date.now() - LOCKOUT_MS);
  const failed = await db.otpToken.findFirst({
    where: {
      phone,
      purpose,
      attempts: { gte: MAX_VERIFY_ATTEMPTS },
      consumedAt: null,
      createdAt: { gte: since },
    },
    orderBy: { createdAt: "desc" },
  });
  return failed !== null;
}

export async function createOtpToken(
  phone: string,
  purpose: OtpPurpose
): Promise<{ code: string; expiresInSec: number }> {
  const normalized = normalizePhone(phone);
  if (!normalized) throw new Error("invalid_phone");
  const code = generateOtp();
  const codeHash = await hashOtp(code, normalized);
  const expiresAt = new Date(Date.now() + OTP_TTL_MS);
  await db.otpToken.create({
    data: {
      phone: normalized,
      purpose,
      codeHash,
      expiresAt,
    },
  });
  return { code, expiresInSec: Math.floor(OTP_TTL_MS / 1000) };
}

type OtpFailReason = "invalid" | "expired" | "locked" | "max_attempts";

const findActiveOtpToken = async (phone: string, purpose: OtpPurpose) => {
  const candidates = await db.otpToken.findMany({
    where: { phone, purpose, consumedAt: null },
    orderBy: { createdAt: "desc" },
    take: 5,
  });
  const now = Date.now();
  return candidates.find((t) => t.expiresAt.getTime() > now) ?? null;
};

/** Check OTP without consuming — call consumeOtpToken only after downstream work succeeds. */
export async function validateOtp(
  phone: string,
  purpose: OtpPurpose,
  code: string
): Promise<{ ok: true; tokenId: string } | { ok: false; reason: OtpFailReason }> {
  const normalized = normalizePhone(phone);
  if (!normalized) return { ok: false, reason: "invalid" };

  if (await isPhoneLocked(normalized, purpose)) {
    return { ok: false, reason: "locked" };
  }

  const token = await findActiveOtpToken(normalized, purpose);
  if (!token) return { ok: false, reason: "expired" };

  const valid = await verifyOtpHash(code, normalized, token.codeHash);
  if (!valid) {
    const attempts = token.attempts + 1;
    await db.otpToken.update({
      where: { id: token.id },
      data: { attempts },
    });
    if (attempts >= MAX_VERIFY_ATTEMPTS) {
      return { ok: false, reason: "locked" };
    }
    return { ok: false, reason: "max_attempts" };
  }

  return { ok: true, tokenId: token.id };
}

export async function consumeOtpToken(tokenId: string): Promise<void> {
  await db.otpToken.update({
    where: { id: tokenId },
    data: { consumedAt: new Date() },
  });
}

export async function consumeOtp(
  phone: string,
  purpose: OtpPurpose,
  code: string
): Promise<{ ok: true } | { ok: false; reason: OtpFailReason }> {
  const result = await validateOtp(phone, purpose, code);
  if (!result.ok) return result;
  await consumeOtpToken(result.tokenId);
  return { ok: true };
}

export const OTP_RESEND_COOLDOWN_SEC = 60;
