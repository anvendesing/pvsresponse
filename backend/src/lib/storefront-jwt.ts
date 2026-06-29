import crypto from "crypto";
import { config } from "../config.js";

export type StorefrontJwtPayload = {
  sub: string;
  phone: string;
};

const b64url = (buf: Buffer | string): string =>
  (typeof buf === "string" ? Buffer.from(buf) : buf)
    .toString("base64")
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");

export function signStorefrontToken(
  payload: StorefrontJwtPayload,
  expiresInDays = 30
): string {
  const header = b64url(JSON.stringify({ alg: "HS256", typ: "JWT" }));
  const exp = Math.floor(Date.now() / 1000) + expiresInDays * 86400;
  const body = b64url(JSON.stringify({ ...payload, exp }));
  const sig = crypto
    .createHmac("sha256", config.storefrontJwtSecret)
    .update(`${header}.${body}`)
    .digest("base64")
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");
  return `${header}.${body}.${sig}`;
}

export function verifyStorefrontToken(token: string): StorefrontJwtPayload | null {
  const parts = token.split(".");
  if (parts.length !== 3) return null;
  const [header, body, sig] = parts;
  const expected = crypto
    .createHmac("sha256", config.storefrontJwtSecret)
    .update(`${header}.${body}`)
    .digest("base64")
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");
  if (sig !== expected) return null;
  try {
    const json = JSON.parse(Buffer.from(body, "base64").toString("utf8")) as StorefrontJwtPayload & {
      exp?: number;
    };
    if (json.exp && json.exp < Math.floor(Date.now() / 1000)) return null;
    if (!json.sub || !json.phone) return null;
    return { sub: json.sub, phone: json.phone };
  } catch {
    return null;
  }
}

export function extractBearerToken(authHeader: string | undefined): string | null {
  if (!authHeader?.startsWith("Bearer ")) return null;
  const token = authHeader.slice(7).trim();
  return token.length > 0 ? token : null;
}
