import { db } from "../db.js";

export type ShiprocketCredentials = {
  email: string;
  password: string;
  pickupPincode: string | null;
};

const maskSecret = (value: string | null | undefined): string | null => {
  if (!value) return null;
  if (value.length <= 4) return "****";
  return `${"*".repeat(Math.min(value.length - 4, 12))}${value.slice(-4)}`;
};

export const maskShiprocketConfig = (row: {
  id: string;
  email: string | null;
  password: string | null;
  pickupPincode: string | null;
  active: boolean;
  updatedAt: Date;
}) => ({
  id: row.id,
  email: row.email,
  password: maskSecret(row.password),
  pickupPincode: row.pickupPincode,
  active: row.active,
  hasPassword: Boolean(row.password),
  updatedAt: row.updatedAt,
});

export async function getShiprocketCredentials(): Promise<ShiprocketCredentials | null> {
  const row = await db.shiprocketConfig.findUnique({ where: { id: "default" } });
  if (row?.active && row.email && row.password) {
    return {
      email: row.email,
      password: row.password,
      pickupPincode: row.pickupPincode,
    };
  }
  const email = process.env.SHIPROCKET_EMAIL?.trim();
  const password = process.env.SHIPROCKET_PASSWORD?.trim();
  if (!email || !password) return null;
  return {
    email,
    password,
    pickupPincode: process.env.SHIPROCKET_PICKUP_PINCODE?.trim() ?? null,
  };
}

export async function getShiprocketPickupPincode(): Promise<string | null> {
  const row = await db.shiprocketConfig.findUnique({ where: { id: "default" } });
  if (row?.pickupPincode && /^\d{6}$/.test(row.pickupPincode)) {
    return row.pickupPincode;
  }
  const creds = await getShiprocketCredentials();
  if (creds?.pickupPincode && /^\d{6}$/.test(creds.pickupPincode)) {
    return creds.pickupPincode;
  }
  return null;
}
